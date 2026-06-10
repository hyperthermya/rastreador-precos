# 💸 Rastreador de Preços e Cupons

Dashboard pessoal que acompanha o melhor preço e as promoções/cupons de produtos de uma
lista de desejos. Roda sozinho e de graça:

- **GitHub Actions** coleta os preços a cada 3 horas (Amazon BR, Mercado Livre, Pelando e Promobit).
- **GitHub Pages** serve o dashboard (pasta [`docs/`](docs/)).
- **Resend** envia email quando um produto fica abaixo do preço-alvo ou atinge um novo
  menor preço histórico.

## Como adicionar/editar produtos

Edite o [`products.json`](products.json) (pelo próprio site do GitHub, link "✏️ Editar
produtos" no dashboard). Campos de cada produto:

| Campo | O que é |
|---|---|
| `id` | identificador único, sem espaços (ex.: `tablet-lenovo-ideatab`) |
| `nome` | nome exibido no dashboard |
| `palavrasChave` | termos usados na busca do Mercado Livre |
| `termosObrigatorios` | palavras que o título do anúncio PRECISA conter (filtra capinha/película) |
| `precoAlvo` | preço que dispara o alerta por email |
| `precoMin` / `precoMax` | faixa plausível de preço (descarta acessórios e anúncios errados) |
| `amazonUrl` | link direto do produto na Amazon (opcional) |

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
