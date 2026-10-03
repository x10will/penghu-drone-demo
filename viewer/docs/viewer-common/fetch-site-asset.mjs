// The exported registry names source-relative JSON paths. Keep callers' URLs
// canonical; only the delivery request changes to the matching .gz file.
export function compressedAssetUrl(input, site, baseUrl) {
  if (!site?.gzipAssets?.length) return null;
  const requested = new URL(input instanceof Request ? input.url : input, baseUrl);
  for (const path of site.gzipAssets) {
    const declared = new URL(`${site.dataBase}/${path}`, baseUrl);
    if (requested.origin === declared.origin && requested.pathname === declared.pathname) {
      requested.pathname += '.gz';
      return requested.href;
    }
  }
  return null;
}

export async function fetchSiteAsset(input, init) {
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const site = globalThis.window?.DT_SITE;
  const gzipUrl = method === 'GET' || method === 'HEAD'
    ? compressedAssetUrl(input, site, globalThis.window?.location?.href)
    : null;
  if (!gzipUrl) return globalThis.fetch(input, init);

  // Cloning a Request retains its signal, credentials and cache policy. An
  // explicit init still has native fetch precedence over those values.
  const request = input instanceof Request ? new Request(gzipUrl, input) : gzipUrl;
  const response = await globalThis.fetch(request, init);
  if (!response.ok || method === 'HEAD') return response;

  // Ordinary static hosts deliver raw .gz bytes. Hosts that label the file
  // Content-Encoding: gzip may cause fetch to decode it before we see it.
  const bytes = new Uint8Array(await response.arrayBuffer());
  const rawGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const hostDecoded = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(response.headers.get('content-encoding') || '');
  if (!rawGzip && !hostDecoded) {
    throw new TypeError(`Declared gzip asset was not gzip encoded: ${gzipUrl}`);
  }
  const body = rawGzip
    ? new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))
    : bytes;
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
