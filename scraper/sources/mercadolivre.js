import {
  UA_GOOGLEBOT,
  fetchComRetry,
  parsePrecoBR,
  normalizar,
  tituloRelevante,
  precoNaFaixa,
  decodificarEntidades,
} from "../lib.js";

// Extrai anúncios da página de busca do Mercado Livre. Função pura (testável).
export function parseMercadoLivre(html) {
  if (html.includes("suspicious-traffic")) return { erro: "bloqueado (verificação anti-robô)" };
  if (html.includes("micro-landing") || html.includes("requires JavaScript")) {
    return { erro: "bloqueado (página exige JavaScript)" };
  }
  const cards = html.split(/<li class="ui-search-layout__item/).slice(1);
  if (cards.length === 0) return { erro: "nenhum card de resultado na página" };

  const anuncios = [];
  for (const card of cards) {
    const titulo = decodificarEntidades((card.match(/poly-component__title[^>]*>([^<]+)</) || [])[1]);
    const url = (card.match(/href="(https:\/\/(?:www\.|produto\.|click1\.)?mercadolivre\.com[^"]+)"/) || [])[1];
    if (!titulo || !url) continue;

    // um card pode ter preço antigo riscado ("--previous") e o preço atual; pegamos o atual
    let preco = null;
    for (const bloco of card.matchAll(
      /class="andes-money-amount([^"]*)"[\s\S]{0,400}?andes-money-amount__fraction[^>]*>([\d.]+)(?:[\s\S]{0,160}?andes-money-amount__cents[^>]*>(\d{1,2}))?/g
    )) {
      if (bloco[1].includes("previous") || bloco[1].includes("polylabel")) continue;
      preco = parsePrecoBR(`${bloco[2]},${bloco[3] ?? "00"}`);
      break;
    }
    if (preco == null) continue;
    anuncios.push({ fonte: "mercadolivre", loja: "Mercado Livre", titulo, preco, url: url.split("#")[0] });
  }
  return { anuncios };
}

export async function buscar(produto) {
  const slug = normalizar(produto.palavrasChave).replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");
  const url = `https://lista.mercadolivre.com.br/${slug}`;
  const html = await fetchComRetry(url, {
    headers: { "User-Agent": UA_GOOGLEBOT, Accept: "text/html,*/*", "Accept-Language": "pt-BR,pt;q=0.9" },
    validar: (h) => parseMercadoLivre(h).erro ?? null,
  });
  const r = parseMercadoLivre(html);
  if (r.erro) throw new Error(r.erro);
  const relevantes = r.anuncios
    .filter((a) => tituloRelevante(a.titulo, produto) && precoNaFaixa(a.preco, produto))
    .sort((a, b) => a.preco - b.preco);
  // dedupe por URL, ficam os 5 mais baratos
  const vistos = new Set();
  const ofertas = [];
  for (const a of relevantes) {
    if (vistos.has(a.url)) continue;
    vistos.add(a.url);
    ofertas.push(a);
    if (ofertas.length >= 5) break;
  }
  return { ofertas };
}
