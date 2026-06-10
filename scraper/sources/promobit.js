import { UAS_DESKTOP, headersNavegador, fetchComRetry, tituloRelevante } from "../lib.js";

// Extrai ofertas do __NEXT_DATA__ da home do Promobit. Função pura (testável).
export function parsePromobit(html) {
  const m = html.match(/__NEXT_DATA__[^>]*>\s*({[\s\S]*?})\s*<\/script>/);
  if (!m) return { erro: "__NEXT_DATA__ não encontrado" };
  let dados;
  try {
    dados = JSON.parse(m[1]);
  } catch {
    return { erro: "__NEXT_DATA__ inválido" };
  }
  const pp = dados?.props?.pageProps ?? {};
  const listas = [pp.serverOffers?.offers, pp.serverFeaturedOffers].filter(Array.isArray);
  const brutas = listas.flat();
  if (brutas.length === 0) return { erro: "nenhuma oferta no __NEXT_DATA__" };

  const ofertas = brutas
    .filter((o) => o?.offerTitle)
    .map((o) => ({
      fonte: "promobit",
      titulo: o.offerTitle,
      preco: typeof o.offerPrice === "number" && o.offerPrice > 0 ? o.offerPrice : null,
      precoAntigo: typeof o.offerOldPrice === "number" && o.offerOldPrice > 0 ? o.offerOldPrice : null,
      cupom: o.offerCoupon || null,
      loja: o.storeName ?? null,
      url: montarUrl(o),
      publicadoEm: o.offerPublished ?? null,
      encerrada: /encerrad|finalizad/i.test(o.offerStatusName ?? ""),
    }));
  return { ofertas };
}

function montarUrl(o) {
  const slug = o.offerSlug ?? "";
  if (/^https?:\/\//.test(slug)) return slug;
  if (slug) return `https://www.promobit.com.br/oferta/${slug.replace(/^\/+|\/+$/g, "")}/`;
  if (o.offerId) return `https://www.promobit.com.br/oferta/${o.offerId}/`;
  return null;
}

export async function buscar(produto) {
  const html = await fetchComRetry("https://www.promobit.com.br/", {
    headers: headersNavegador(UAS_DESKTOP[0]),
  });
  const r = parsePromobit(html);
  if (r.erro) throw new Error(r.erro);
  const vistos = new Set();
  const promocoes = [];
  for (const o of r.ofertas) {
    if (o.encerrada || !o.url || vistos.has(o.url)) continue;
    if (!tituloRelevante(o.titulo, produto)) continue;
    vistos.add(o.url);
    promocoes.push(o);
  }
  return { promocoes };
}
