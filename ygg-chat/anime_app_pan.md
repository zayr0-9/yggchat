# Anime App Plan (rough)

## Overview
- Goal: prototype a custom tool/app where AI-1 handles chat while AI-2 selects and drives character animations.
- Core idea: AI-2 emits structured tool calls (play/blend/pose) against a small library of prebuilt clips.
- V1 scope: fixed humanoid skeleton, preexisting clips, simple crossfades, and a basic motion state machine.
- Runtime: three.js AnimationMixer + SkinnedMesh; per-frame updates with safe angle limits and smoothing.
- Guardrails: cooldowns, clip conflict rules (e.g., no wave while walk unless allowed), and fallback idle.
- V2: blend atomic gestures on top of locomotion, add head/eye look-at, and optional text-to-motion later.

## Resources
- Animation sources
  - Mixamo (free with Adobe ID) for humanoid clips.
  - three.js RobotExpressive sample model for quick pipeline validation.
  - Khronos glTF Sample Models for reference assets.
  - CMU Motion Capture Database for raw mocap (conversion/retargeting needed).
  - Rokoko Motion Library and ActorCore (some paid).
- Docs / references
  - three.js: AnimationMixer, AnimationAction, Skeleton, SkinnedMesh, GLTFLoader.
  - glTF 2.0 spec for animation/skeleton data.
  - Blender retargeting workflows and Mixamo bone naming conventions.

