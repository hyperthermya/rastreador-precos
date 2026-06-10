// Utilidades compartilhadas pelas fontes.

export const UAS_DESKTOP = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
];

export const UA_GOOGLEBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/137.0.0.0 Safari/537.36";

export function headersNavegador(ua) {
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "upgrade-insecure-requests": "1",
  };
}

// Busca uma URL com tentativas e backoff. Lança erro se todas falharem.
export async function fetchComRetry(url, { headers, tentativas = 3, timeoutMs = 25000, validar } = {}) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000 * i));
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const resp = await fetch(url, { headers, redirect: "follow", signal: ctl.signal });
      clearTimeout(t);
      const html = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (validar) {
        const problema = validar(html);
        if (problema) throw new Error(problema);
      }
      return html;
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}

// "1.999,90" -> 1999.9 | "1.999" -> 1999
export function parsePrecoBR(texto) {
  if (texto == null) return null;
  const limpo = String(texto).replace(/[^\d.,]/g, "");
  if (!limpo) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// minúsculas + sem acentos, para comparação de palavras-chave
export function normalizar(s) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// título contém todos os termos obrigatórios do produto?
export function tituloRelevante(titulo, produto) {
  const t = normalizar(titulo);
  return (produto.termosObrigatorios ?? []).every((termo) => t.includes(normalizar(termo)));
}

// preço dentro da faixa plausível do produto?
export function precoNaFaixa(preco, produto) {
  if (preco == null) return false;
  const min = produto.precoMin ?? 0;
  const max = produto.precoMax ?? Infinity;
  return preco >= min && preco <= max;
}

export function decodificarEntidades(s) {
  return (s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
