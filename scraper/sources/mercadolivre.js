import {
  UA_GOOGLEBOT,
  UAS_DESKTOP,
  fetchComRetry,
  parsePrecoBR,
  normalizar,
  tituloRelevante,
  precoNaFaixa,
  decodificarEntidades,
} from "../lib.js";

// Alterna entre o UA do Googlebot (costuma passar direto, ML libera bots de
// busca) e UAs de navegador real nas tentativas seguintes — só Googlebot fixo
// se torna previsível sob volume alto de requisições e passa a ser bloqueado
// junto (2026-07-16: observado em sessão de teste intensa).
function uaPorTentativa(tentativa) {
  if (tentativa === 0) return UA_GOOGLEBOT;
  return UAS_DESKTOP[(tentativa - 1) % UAS_DESKTOP.length];
}

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

// Além da busca padrão por palavras-chave, um produto pode informar
// `mercadoLivreUrls`: URLs de busca/categoria já filtradas (ex.: usados,
// faixa de preço, "com bateria removível") coladas direto da navegação manual.
// Todas são buscadas e os anúncios combinados antes do filtro de relevância.
export async function buscar(produto, { freteGratis = false, limite = 5 } = {}) {
  const slug = normalizar(produto.palavrasChave).replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");
  const sufixoFrete = freteGratis ? "_CustoFrete_Gratis_NoIndex_True" : "";
  const urls = [`https://lista.mercadolivre.com.br/${slug}${sufixoFrete}`, ...(produto.mercadoLivreUrls ?? [])];

  const anuncios = [];
  const erros = [];
  for (const url of urls) {
    try {
      const html = await fetchComRetry(url.split("#")[0], {
        tentativas: 4,
        headers: (tentativa) => ({
          "User-Agent": uaPorTentativa(tentativa),
          Accept: "text/html,*/*",
          "Accept-Language": "pt-BR,pt;q=0.9",
        }),
        validar: (h) => parseMercadoLivre(h).erro ?? null,
      });
      const r = parseMercadoLivre(html);
      if (r.erro) throw new Error(r.erro);
      anuncios.push(...r.anuncios);
    } catch (e) {
      erros.push(e);
    }
  }
  // só falha se NENHUMA das URLs deu resultado
  if (anuncios.length === 0 && erros.length > 0) throw erros[0];

  const relevantes = anuncios
    .filter((a) => tituloRelevante(a.titulo, produto) && precoNaFaixa(a.preco, produto))
    .sort((a, b) => a.preco - b.preco);
  // dedupe pela URL sem query string (o mesmo anúncio pode aparecer em buscas
  // diferentes com parâmetros de rastreio/pdp_filters distintos), ficam os 5 mais baratos
  const vistos = new Set();
  const ofertas = [];
  for (const a of relevantes) {
    const chave = a.url.split("?")[0];
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    ofertas.push(a);
    if (ofertas.length >= limite) break;
  }
  return { ofertas };
}
