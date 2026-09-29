# Testes de relevância — metodologia e resultados

## O que é medido

Para cada consulta, a busca roda como na página (primeira página de todas as fontes e, se vierem menos de 12 resultados relevantes, mais um passo de rolagem infinita). Depois, o **oráculo** da consulta julga cada item.

| Métrica | Significado |
|---|---|
| **First 6** (P@6) | quantos dos 6 primeiros resultados da lista principal são relevantes |
| **Relevant (main)** | relevantes na lista principal (acima de "Less related") |
| **Verdict** | `PASS` se P@6 = 6 **e** relevantes ≥ 6 · `WARN` se P@6 ≥ 5 · `FAIL` nos demais casos |

Os oráculos ficam em [`js/suite.js`](../js/suite.js) e foram **escritos à parte do ranqueador**, com regex e listas de artistas próprias. Assim a suíte mede o ranking em vez de concordar com ele. Exemplos:

- **Autor:** o campo de artista precisa conter o artista, e atribuições como workshop, seguidor, cópia ou "after" não contam. "van gogh" exige *Vincent* em qualquer ordem de nome ("Gogh, Vincent van", "V. van Gogh"): "Theo van Gogh" ou outro van Gogh não passam. "rembrandt" não aceita Rembrandt Peale.
- **Tema:** título, etiquetas ou descrição precisam falar do tema ("cat, kitten…"; "horse, equestrian, cavalry…"), ou o Wikidata precisa afirmar que a obra *retrata* o tema (`P180`). O português "gato(s)" **não** conta sozinho, porque nesses catálogos casa com nomes de lugar como Los Gatos.
- **Estilo:** artista do movimento (lista própria do oráculo), menção ao estilo nas etiquetas ou no texto, ou o Wikidata afirmando o movimento (`P135`).

### Consultas

| Categoria | Consultas |
|---|---|
| Autor | van gogh · Claude Monet · rembrandt · hokusai · vermeer · Almeida Júnior · pinturas de Monet |
| Tema | cats · gatos · cavalos · flores · the sea · natureza morta · retrato |
| Estilo | impressionism · impressionismo · barroco · ukiyo-e · pontilhismo · art nouveau · romantismo |
| Diagnóstico original | brazil · van gogh · medieval |

## Como rodar

| Onde | Comando | Observação |
|---|---|---|
| Offline (qualquer máquina) | `npm test` | 43 testes; rede simulada por [`tests/fixtures/world.js`](../tests/fixtures/world.js) |
| Navegador, rede simulada | `npm run test:ui` | Chromium headless via Playwright (`npm i -D playwright` se não houver instalação global) |
| **Ao vivo** | `npm run test:live` | APIs reais; relatório em `tests/report/` |
| Antes × depois | `npm run test:compare` | motor novo × merge antigo, mesmas consultas |
| Na própria página | "run diagnostics" no rodapé, ou `index.html?autotest=1` | inclui a checagem de imagens dos 6 primeiros; resultado em `window.__TEST_REPORT__` |

Atrás de um proxy HTTP (Node ≥ 22.21): `NODE_USE_ENV_PROXY=1 npm run test:live`.

## Resultados

### Offline — rede simulada (2026-09-29)

O mundo simulado responde no formato real de cada API e mistura, na ordem de cada fonte, registros relevantes e irrelevantes típicos: pôster de exposição, catálogo, retrato de outro artista, "Los Gatos Creek", "Catskill Mountains", "Catherine of Aragon", fotografia de galeria, cópia "after Van Gogh".

| Consulta | Entendida como | P@6 novo | P@6 antigo (round-robin) |
|---|---|---|---|
| van gogh | artista · Vincent van Gogh (Q5582) | **6/6** (15 relevantes) | 0/6 |
| gatos | assunto · cat (Q146) | **6/6** (14 relevantes) | 0/6 |
| impressionismo | movimento · Impressionism (Q40415) | **6/6** (11 relevantes) | 0/6 |

<details>
<summary>Os 6 primeiros de cada lado</summary>

**van gogh, motor novo:** Self-Portrait with a Straw Hat (Met) · Wheat Field with Cypresses (Met) · Irises (Met) · The Starry Night (Wikidata/MoMA) · Sunflowers (Wikidata/National Gallery) · The Potato Eaters (Wikidata/Van Gogh Museum). Na seção "Less related" ficaram a cópia "after Van Gogh", a foto do Wellcome, o retrato de Jan van Gogh no SMK e o Gauguin do AIC.

**van gogh, merge antigo:** Gauguin (AIC) · catálogo de exposição (Cleveland) · pôster (V&A) · retrato de Jan van Gogh (SMK) · foto (Wellcome) · entrada do Van Gogh Museum (Commons).

**gatos, motor novo:** Cat Watching a Spider (Met, etiqueta Cats = Q146) · Girl with a Kitten, The Cat's Lunch, Two Cats (Wikidata, retrata = Q146) · Girl with a Cat, Kitten in a Basket (Met). O SMK recebeu `kat`; "Catskill Mountains", "Catherine of Aragon" e "Catalogue cover" ficaram em "Less related".

**gatos, merge antigo:** "Los Gatos Creek" (AIC) e um mapa de Los Gatos (Commons). Nada mais, porque "gatos" não casa com catálogos em inglês.

**impressionismo, motor novo:** Impression, Sunrise e Bal du moulin de la Galette (Wikidata, P135) · Water Lilies e Paris Street; Rainy Day (AIC, style_titles) · Bridge over a Pond of Water Lilies e Madame Charpentier (destaques do Met para Monet e Renoir).

**impressionismo, merge antigo:** nenhum resultado.
</details>

Outros cenários cobertos pelos testes offline: "cats" não vira o musical; "flores" não vira a ilha; "van gogh" não vira Theo nem o museu; sem Wikidata, "gatos" continua com ≥ 6 relevantes graças ao léxico; sem SPARQL, "van gogh" continua classificado como artista pela descrição; o registro do Met substitui sua cópia no Wikidata; uma fonte com erro é reportada e as demais renderizam.

### Navegador — Chromium headless com rede simulada

8/8: painel de contexto (Van Gogh, com "Post-Impressionism" em Explore) e 6 cartões relevantes · linha do tempo ano a ano e em ordem · modal aberto por teclado com "Why shown", fechado com Esc · "gatos" em PT sem cartão irrelevante no topo e URL `?q=gatos` · chip "palavras exatas" · chip de artista do movimento (Impressionismo → Claude Monet) · suíte rodando dentro da página · 380 px sem rolagem horizontal · zero erros de JavaScript.

### Ao vivo — pendente

O ambiente em nuvem onde esta mudança foi desenvolvida bloqueia, por política de rede, todos os hosts dos museus e do Wikidata (HTTP 403 no proxy de saída). Por isso a suíte ao vivo **ainda não foi executada contra as APIs reais**. O runner foi exercitado mesmo assim e degradou como deveria: entendeu "gatos" pelo léxico e reportou cada fonte bloqueada.

Para preencher esta seção, rode numa máquina com internet:

```bash
npm run test:compare     # motor novo × antigo; gera tests/report/live-*.md
```

e cole abaixo a tabela gerada. Se alguma consulta falhar, o relatório lista os itens irrelevantes entre os 12 primeiros e a contagem por fonte, o que basta para calibrar os pesos em `js/rank.js` (seção 6 do [prompt](PROMPT.md)).

| Consulta | Entendida como | P@6 | Relevantes | Veredito |
|---|---|---|---|---|
| *(aguardando execução ao vivo)* | | | | |

### Limitações esperadas na execução ao vivo

- **Almeida Júnior** depende do Wikidata/Commons (nenhum dos museus com API tem obras dele). Se o WDQS estiver instável, pode ficar abaixo de 6.
- **Vermeer:** só ~35 obras existem. O Met tem 5, e o resto vem do Wikidata.
- **Art nouveau** e **pontilhismo** têm menos obras em domínio público com metadado de estilo. O Wikidata (P135) e as listas de artistas compensam.
- Artistas com obra ainda protegida por direitos autorais (Tarsila, Picasso, Frida Kahlo) estão fora da suíte de propósito, porque os acervos abertos não publicam essas imagens.
