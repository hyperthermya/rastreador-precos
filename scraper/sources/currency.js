// Câmbio via Frankfurter (https://www.frankfurter.dev) — API pública gratuita, sem
// chave/autenticação e sem limite de requisições, mantida pelo Banco Central Europeu.
// Usado para converter preços de compras internacionais (AliExpress em USD/CNY) e
// estimar o imposto de importação em cima do valor convertido.

const BASE_URL = "https://api.frankfurter.dev/v1/latest";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — câmbio não muda o suficiente pra justificar buscar toda hora

const cache = new Map(); // moeda -> { taxa, buscadoEm }

// Retorna quantos BRL equivalem a 1 unidade da moeda de origem (ex.: "USD" -> ~5.30).
export async function taxaParaBRL(moedaOrigem = "USD") {
  const chave = moedaOrigem.toUpperCase();
  const emCache = cache.get(chave);
  if (emCache && Date.now() - emCache.buscadoEm < CACHE_TTL_MS) {
    return emCache.taxa;
  }

  const resp = await fetch(`${BASE_URL}?from=${chave}&to=BRL`);
  if (!resp.ok) throw new Error(`Frankfurter HTTP ${resp.status}`);
  const dados = await resp.json();
  const taxa = dados?.rates?.BRL;
  if (typeof taxa !== "number") throw new Error(`Frankfurter não retornou taxa BRL para ${chave}`);

  cache.set(chave, { taxa, buscadoEm: Date.now() });
  return taxa;
}

// Converte um valor de uma moeda estrangeira para BRL usando o câmbio atual.
export async function converterParaBRL(valor, moedaOrigem = "USD") {
  if (valor == null || !Number.isFinite(valor)) return null;
  const taxa = await taxaParaBRL(moedaOrigem);
  return valor * taxa;
}

// Estimativa simples de imposto de importação pra compra internacional (AliExpress etc.):
// - até US$50 declarado, remetente pessoa física: isento (regra da Receita Federal)
// - acima disso: 60% de imposto sobre o valor do produto + frete, menos R$ do limite de isenção
// Isso é uma estimativa grosseira pra comparação de preços, não um cálculo fiscal oficial —
// a alíquota/regra real varia conforme declaração da plataforma e mudanças na legislação.
export async function estimarPrecoComImposto(valorProduto, moedaOrigem = "USD", { aliquota = 0.6, limiteIsencaoUSD = 50 } = {}) {
  if (valorProduto == null || !Number.isFinite(valorProduto)) return null;
  const taxa = await taxaParaBRL(moedaOrigem);
  const valorBRL = valorProduto * taxa;

  const isento = moedaOrigem.toUpperCase() === "USD" && valorProduto <= limiteIsencaoUSD;
  const impostoBRL = isento ? 0 : valorBRL * aliquota;

  return {
    valorOriginal: valorProduto,
    moedaOriginal: moedaOrigem.toUpperCase(),
    taxaCambio: taxa,
    valorBRL: Number(valorBRL.toFixed(2)),
    impostoEstimadoBRL: Number(impostoBRL.toFixed(2)),
    totalComImpostoBRL: Number((valorBRL + impostoBRL).toFixed(2)),
    isento,
  };
}
