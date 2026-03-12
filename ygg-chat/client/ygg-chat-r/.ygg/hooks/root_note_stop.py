import json
import sys
from urllib import request, error

MODEL = 'gpt-5.1-codex-mini'
PROVIDER = 'openai'

SYSTEM_PROMPT = '''You maintain a concise running root-note for a conversation.

Update the note only if the latest turn materially changes it.
Keep it brief.
Preserve still-relevant context, remove stale or redundant points, and prefer 3-7 bullets.

Required output format for the note text:
[note title - short description]
- bullet 1
- bullet 2
- bullet 3

Return JSON only:
{
  "updated": true | false,
  "note": "full note text when updated, otherwise empty string",
  "reason": "short reason"
}

Set updated=false if the current note is already adequate.
Do not include markdown fences.
'''


def _json_request(url, method='GET', payload=None, timeout=20):
    data = None
    headers = {'Content-Type': 'application/json'}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
    req = request.Request(url, data=data, headers=headers, method=method)
    with request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode('utf-8')
        return json.loads(body) if body else {}


def _safe_text(value):
    return value if isinstance(value, str) else ''


def _parse_model_json(text):
    text = (text or '').strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        start = text.find('{')
        end = text.rfind('}')
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                return None
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print('{}')
        return

    try:
        if payload.get('hook_event_name') != 'Stop':
            print('{}')
            return

        lookup = payload.get('lookup') or {}
        local_api_base = _safe_text(lookup.get('local_api_base')).rstrip('/')
        conversation_id = _safe_text(payload.get('conversation_id'))
        lineage = payload.get('lineage') or {}
        turn = payload.get('turn') or {}

        if not local_api_base or not conversation_id:
            print('{}')
            return

        root_message_id = _safe_text(lineage.get('root_message_id'))
        last_user_message_id = _safe_text(turn.get('last_user_message_id'))
        last_assistant_message_id = _safe_text(turn.get('last_assistant_message_id'))
        last_assistant_text = _safe_text(payload.get('last_assistant_message'))

        messages = _json_request(f'{local_api_base}/app/conversations/{conversation_id}/messages')
        if not isinstance(messages, list) or not messages:
            print('{}')
            return

        message_by_id = {str(m.get('id')): m for m in messages if isinstance(m, dict) and m.get('id') is not None}

        root_message = message_by_id.get(root_message_id)
        if root_message is None:
            root_candidates = [m for m in messages if isinstance(m, dict) and m.get('parent_id') is None]
            root_message = root_candidates[0] if root_candidates else None

        if not root_message:
            print('{}')
            return

        root_message_id = str(root_message.get('id'))
        root_message_content = _safe_text(root_message.get('content'))
        existing_note = _safe_text(root_message.get('note'))

        last_user_message = message_by_id.get(last_user_message_id) if last_user_message_id else None
        last_assistant_message = message_by_id.get(last_assistant_message_id) if last_assistant_message_id else None

        latest_user_text = _safe_text((last_user_message or {}).get('content'))
        latest_assistant_text = _safe_text((last_assistant_message or {}).get('content')) or last_assistant_text

        if not latest_user_text and not latest_assistant_text:
            print('{}')
            return

        model_input = (
            'Existing root note:\n'
            f'{existing_note or "<empty>"}\n\n'
            'Root message:\n'
            f'{root_message_content or "<empty>"}\n\n'
            'Latest user message:\n'
            f'{latest_user_text or "<empty>"}\n\n'
            'Latest assistant message:\n'
            f'{latest_assistant_text or "<empty>"}\n\n'
            'Update the root note only if needed. Keep it brief.'
        )

        generation = _json_request(
            f'{local_api_base}/headless/ygg-hooks/generate',
            method='POST',
            payload={
                'provider': PROVIDER,
                'modelName': MODEL,
                'systemPrompt': SYSTEM_PROMPT,
                'content': model_input,
            },
            timeout=45,
        )

        model_text = _safe_text(generation.get('text'))
        model_json = _parse_model_json(model_text)
        if not isinstance(model_json, dict):
            print('{}')
            return

        updated = bool(model_json.get('updated'))
        next_note = _safe_text(model_json.get('note')).strip()

        if not updated or not next_note or next_note == existing_note:
            print('{}')
            return

        _json_request(
            f'{local_api_base}/app/messages/{root_message_id}',
            method='PUT',
            payload={'note': next_note},
            timeout=20,
        )

        print('{}')
    except error.HTTPError:
        print('{}')
    except Exception:
        print('{}')


if __name__ == '__main__':
    main()
