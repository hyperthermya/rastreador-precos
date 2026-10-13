# 💸 Rastreador de Preços e Cupons

Dashboard pessoal que acompanha o melhor preço e as promoções/cupons de produtos de uma
lista de desejos. Roda sozinho e de graça:

- **GitHub Actions** coleta os preços a cada 3 horas (Amazon BR, Mercado Livre, Pelando e Promobit).
- **AliExpress** roda separado, 1x/dia (`.github/workflows/aliexpress.yml`) — usa navegador headless
  (Puppeteer + stealth) porque a busca do site é toda renderizada via JS, diferente das outras
  fontes (fetch simples + regex). Só roda para produtos marcados com `"aliexpress": true` em
  `products.json` (ex.: peças de nicho que não aparecem no Mercado Livre, como controlador VESC).
  Os resultados ficam em `docs/data/aliexpress.json` e são mesclados nos mesmos cards pelo
  dashboard — não passam pelo sistema de alertas por email por enquanto.
- **Vercel** serve o dashboard (pasta [`docs/`](docs/), Root Directory `docs`), republicando a cada push de dados.
- **Resend** envia email quando um produto fica abaixo do preço-alvo ou atinge um novo
  menor preço histórico.

Também monitora **cupons gerais de loja** (campanhas tipo "MEIOCAMPO" da Amazon) via
Cuponomia, num painel separado no topo do dashboard. As lojas monitoradas ficam em
`lojasCupons` no [`products.json`](products.json). Um **vigia de cupons** roda a cada
~15 min (workflow `cupons.yml`) e envia email quando surge um cupom novo nas lojas
marcadas com `"alerta": true` (por padrão Mercado Livre e Amazon, que esgotam rápido).

## Como adicionar/editar produtos

**Pelo dashboard:** botão **➕ Adicionar produto** — preenche nome, preço-alvo, palavras
e a senha de administração. Salva direto no `products.json` (via função no Vercel) e
dispara uma coleta na hora. Requer os secrets `GITHUB_TOKEN` e `ADD_PASSWORD` no Vercel.

**Manualmente:** edite o [`products.json`](products.json) (link "✏️ Editar produtos").
Campos de cada produto:

| Campo | O que é |
|---|---|
| `id` | identificador único, sem espaços (ex.: `tablet-lenovo-ideatab`) |
| `nome` | nome exibido no dashboard |
| `palavrasChave` | termos usados na busca do Mercado Livre |
| `termosObrigatorios` | palavras que o título do anúncio PRECISA conter (ex.: `jbl, 510`) |
| `termosProibidos` | palavras que fazem o anúncio ser ignorado (ex.: `capinha, película`) |
| `precoAlvo` | preço que dispara o alerta por email |
| `precoMin` / `precoMax` | faixa plausível de preço (descarta acessórios e anúncios errados) |
| `amazonUrl` | link direto do produto na Amazon (opcional) |
| `mercadoLivreUrls` | lista de URLs de busca/categoria do Mercado Livre já com filtros aplicados (usado, faixa de preço, características como "bateria removível") — colar direto da barra de endereço depois de configurar os filtros manualmente no site. Buscadas além da busca padrão por `palavrasChave`; os anúncios de todas as URLs são combinados antes do filtro de relevância (opcional) |
| `aliexpress` | `true` para incluir o produto na coleta diária do AliExpress (opcional, só para o que não acha no ML) |
| `aliexpressBusca` | termo de busca alternativo para o AliExpress, quando o termo em português não existe no catálogo (opcional — sem isso usa `palavrasChave`) |

## Como força uma atualização agora

Aba **Actions** → workflow **Rastrear preços** → botão **Run workflow**.

## Estrutura

- `scraper/` — coletor em Node.js (sem dependências). Uma fonte falhar não derruba a
  rodada: o dado anterior é mantido e marcado como "coleta antiga" no dashboard.
- `docs/` — dashboard estático + dados (`docs/data/*.json`).
- `.github/workflows/track.yml` — agendamento e commit automático dos dados.

## Testes

```bash
cd scraper && npm test
```

Os parsers são testados contra HTML real salvo em `scraper/test/fixtures/`. Se um site
mudar de layout, a fonte aparece como "falhou" no dashboard — atualize o fixture e o
parser correspondente em `scraper/sources/`.

## Segredos (Settings → Secrets and variables → Actions)

- `RESEND_API_KEY` — chave da API do [Resend](https://resend.com).
- `ALERT_EMAIL` — email que recebe os alertas (no plano grátis do Resend sem domínio
  próprio, deve ser o email da própria conta Resend).
