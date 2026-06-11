import { UAS_DESKTOP, headersNavegador, fetchComRetry, parsePrecoBR, decodificarEntidades } from "../lib.js";

// Extrai título e preço da página de produto da Amazon. Função pura (testável).
export function parseAmazon(html) {
  if (/api-services-support@amazon\.com|Digite os caracteres|captcha/i.test(html) && !/productTitle/.test(html)) {
    return { erro: "bloqueado (captcha)" };
  }
  const titulo = decodificarEntidades((html.match(/<span id="productTitle"[^>]*>\s*([^<]+?)\s*</) || [])[1]);
  if (!titulo) return { erro: "página sem título de produto" };
  if (/atualmente indisponível/i.test(html)) return { titulo, indisponivel: true };

  // preferência: JSON embutido do bloco de preço; fallback: spans a-price
  let preco = null;
  const m = html.match(/"priceAmount":([\d.]+)/);
  if (m) preco = Number(m[1]);
  if (preco == null) {
    const core = html.split(/corePriceDisplay|corePrice_feature_div/)[1] ?? html;
    const inteiro = (core.match(/class="a-price-whole">([\d.,]+)/) || [])[1];
    const centavos = (core.match(/class="a-price-fraction">(\d{2})/) || [])[1] ?? "00";
    if (inteiro) preco = parsePrecoBR(`${inteiro},${centavos}`);
  }
  if (preco == null) return { titulo, erro: "preço não encontrado" };
  return { titulo, preco };
}

export async function buscar(produto) {
  if (!produto.amazonUrl) return { ofertas: [], pulada: true };
  const url = produto.amazonUrl.split("?")[0];
  // A Amazon bloqueia de forma intermitente: troca de user-agent a cada tentativa
  // (deslocando o índice por sorteio) e adiciona cabeçalhos de navegação real.
  const inicio = Math.floor(Math.random() * UAS_DESKTOP.length);
  const html = await fetchComRetry(url, {
    tentativas: 4,
    headers: (tentativa) => ({
      ...headersNavegador(UAS_DESKTOP[(inicio + tentativa) % UAS_DESKTOP.length]),
      Referer: "https://www.google.com/",
      "sec-ch-ua": '"Chromium";v="137", "Google Chrome";v="137", "Not/A)Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-fetch-site": "cross-site",
    }),
    validar: (h) => (parseAmazon(h).erro === "bloqueado (captcha)" ? "bloqueado (captcha)" : null),
  });
  const r = parseAmazon(html);
  if (r.erro) throw new Error(r.erro);
  if (r.indisponivel) return { ofertas: [] };
  return { ofertas: [{ fonte: "amazon", loja: "Amazon", titulo: r.titulo, preco: r.preco, url }] };
}
