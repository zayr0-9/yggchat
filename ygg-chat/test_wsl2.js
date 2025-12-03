function toWslPath(rawPath) {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  
  // Convert backslashes to forward slashes first
  let normalized = trimmed.replace(/\\/g, '/');
  let lowerNormalized = normalized.toLowerCase();
  
  const isUncWSLPath = /^\/{2,}wsl\$/i.test(lowerNormalized);
  
  console.log('Input:', rawPath);
  console.log('Normalized:', normalized);
  console.log('Lower normalized:', lowerNormalized);
  console.log('Is UNC WSL path?', isUncWSLPath);
  
  if (isUncWSLPath) {
    const withoutLeadingSlashes = normalized.replace(/^\/+/g, '');
  const segments = withoutLeadingSlashes.split('/').filter(Boolean);
  console.log('Segments:', segments);
    
    if (segments.length >= 2 && segments[0].toLowerCase() === 'wsl$') {
      const remainder = segments.slice(2).join('/');
      const result = remainder ? '/' + remainder : '/';
      console.log('Result:', result);
      return result;
  }
  
  console.log('Not UNC WSL path, returning normalized:', normalized);
  return normalized;
}

const testPath = '\\\\wsl$\\Ubuntu\\home\\karn\\webbdrasil\\Webdrasil\\ygg-chat';
console.log('Testing toWslPath with:', testPath);
const result = toWslPath(testPath);
console.log('Final result:', result);
