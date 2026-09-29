# embusca — revisão completa e plano de busca inteligente

> Objetivo: **toda busca por autor, tema ou estilo traz pelo menos 6 resultados relevantes, e os 6 primeiros resultados exibidos são todos relevantes.**
> Este documento reúne a revisão do projeto, o diagnóstico da busca, a estratégia adotada (incluindo a avaliação de MCPs), as duas features novas, como tudo é testado e o que vem depois.
> O prompt com todas as especificações está em [`PROMPT.md`](PROMPT.md); a metodologia e os resultados dos testes, em [`RELEVANCIA.md`](RELEVANCIA.md).

---

## 1. Resumo

| | Antes | Agora |
|---|---|---|
| O que é enviado às APIs | o texto cru, igual para as 7 fontes | a **intenção** entendida (artista, movimento, gênero, assunto, lugar, obra) traduzida no parâmetro certo de cada API |
| Português | "gatos" chegava assim a museus que catalogam em inglês (e ao SMK, que cataloga em dinamarquês) | "gatos" → Wikidata `Q146` → `cat` para os museus, `kat` para o SMK |
| Fonte semântica | Wikimedia Commons por texto + a palavra "painting" | **Wikidata SPARQL**: obras cujo criador, movimento, gênero ou tema *é* o que foi buscado, com imagem do Commons |
| Ordem dos resultados | round-robin: o 1º de cada fonte, depois o 2º… (relevante ou não) | **ranking por evidência** (0–1, com o motivo), diversidade entre fontes, deduplicação por QID |
| Resultados fracos | misturados no topo | separados em "Less related results", nunca no topo |
| The Met | `/v1/search`, que **é desativado em 01/10/2026** | `/v1.1/search` paginado + destaques (`isHighlight`) + etiquetas de assunto (`tags=true`) + cache local dos objetos |
| Testes | um painel de diagnóstico de imagens | suíte de relevância (21 consultas + 3 do diagnóstico original) no navegador e no Node, 43 testes offline e 8 verificações de interface no Chromium |

No mundo simulado dos testes offline, com respostas no formato real de cada API, o algoritmo antigo acerta **0 de 6** no topo para "van gogh", "gatos" e "impressionismo". O novo acerta **6 de 6** nas três.

---

## 2. Revisão do projeto

**O que é:** uma página estática (sem build, sem chave de API, sem dependências) que busca obras em domínio público em sete acervos abertos: The Met, Art Institute of Chicago, Cleveland, V&A, SMK, Wikimedia e Wellcome. Tem grade com rolagem infinita, detalhe da obra com imagem em alta resolução, sugestões "More like this" e um painel de diagnóstico.

**Pontos fortes que foram mantidos:** zero dependências; funciona abrindo o arquivo; degrada bem quando uma fonte falha; detecta quando o CDN de imagens do AIC recusa a rede; troca a miniatura pela alta resolução só quando ela carrega; visual limpo.

### Problemas encontrados

| Sev. | Problema | Efeito | Correção |
|---|---|---|---|
| 🔴 | O Met aposenta `GET /public/collection/v1/search` em **01/10/2026** | a fonte Met pararia de funcionar em 2 dias | migração para `/v1.1/search` (`offset`/`limit`, janela de 10 000) |
| 🔴 | Merge round-robin sem relevância | o topo recebia o 1º item de *cada* fonte: pôster da V&A, catálogo de Cleveland, retrato de outro artista no SMK | ranking único por evidência, com limiar e seção de "menos relacionados" |
| 🟠 | Texto cru enviado a todas as APIs | nenhum filtro de artista ou assunto é usado; PT não casa com catálogos em EN/DA | camada de entendimento + parâmetros específicos por API |
| 🟠 | Commons buscado por texto + " painting" | fotos de fachadas de museu, mapas, reproduções | Wikidata SPARQL para entidades; Commons só como fallback, com filtro de não-arte |
| 🟠 | "Página fina = fonte esgotada" (lista *filtrada* < 50%) | fontes encerradas cedo demais | cada adaptador informa `done` pela paginação real da API |
| 🟡 | Met N+1: até 60 requisições por página, retry de até ~37 s, sem cache | lento e sujeito a bloqueio | janela de 30 IDs, concorrência 6, cache persistente de objetos, timeout por fonte |
| 🟡 | Bandeiras por regex sem limite de palavra | "Toledo" virava Japão (`edo`), "Perugia" virava Peru, "Tirana" virava Irã | regex com `\b` e frases continentais ignoradas |
| 🟡 | `innerHTML` em elemento vivo para limpar HTML do Commons | um `<img onerror>` executaria | `DOMParser` (documento inerte) |
| 🟡 | Diagnóstico sobrescrevia o estado da busca (`items`, `seenKeys`, `pager`) | abrir o diagnóstico corrompia a grade | cada consulta roda numa `Session` isolada |
| 🟡 | Cards `div` sem foco/teclado; modal sem `aria` | inacessível por teclado e leitor de tela | `tabindex`, `role`, Enter/Espaço, foco preso e devolvido no modal |
| 🟡 | Sem URL compartilhável; sem testes fora do navegador | impossível compartilhar ou automatizar | `?q=…&pin=…` com histórico; suíte no Node |

---

## 3. Estratégia: consultas mais inteligentes

A ideia central: **não pedir o texto do usuário a sete APIs diferentes; entender o que ele quer e pedir a cada API do jeito que ela responde melhor.** São quatro camadas.

### 3.1 Entender a consulta (`js/intent.js` + `js/lexicon.js`)

1. **Parsing:** remove palavras genéricas nas bordas ("pinturas de", "arte", "paintings") e guarda o suporte pedido (`pinturas` → prioriza pinturas). Gera variantes: singular (`gatos` → `gato`, `flores` → `flor`, `paisagens` → `paisagem`), adjetivo → movimento (`impressionist` → `impressionism`) e forma hifenizada quando o léxico a conhece (`natureza morta` → `natureza-morta`).
2. **Wikidata (sem chave, com CORS):** `wbsearchentities` em PT e EN, `wbgetentities` (rótulos EN/PT/DA/`mul`, aliases, sitelinks) e um SPARQL mínimo para os tipos (`P31`) e ocupações (`P106`). Cada candidato recebe uma pontuação: qualidade do casamento, tipo (artista, movimento e gênero valem mais que filme, musical, sobrenome), popularidade (sitelinks) e concordância com o léxico.
3. **Léxico embutido** (~90 termos de arte em EN/PT/DA e artistas-chave de 24 movimentos): funciona offline, desempata ("flores" é flor, não a ilha indonésia) e mantém a busca em português funcionando se o Wikidata cair.
4. **Enriquecimento em paralelo:** para artista, movimentos e datas de vida; para movimento, os artistas mais conhecidos e o período; para obra, o autor; para lugar, o gentílico.

### 3.2 Perguntar certo a cada API (`js/sources.js`)

| Fonte | Artista | Movimento | Assunto / gênero | Observação |
|---|---|---|---|---|
| The Met | nome completo + `isHighlight=true` primeiro | destaques dos 3 artistas-chave do movimento | `tags=true` (etiquetas de assunto, com QID do Wikidata) | `/v1.1/search`; `artistOrCulture=true` está quebrado no Met (sempre 0) e não é usado |
| AIC | nome | `q` + `style_titles` na pontuação | `subject_titles`, `term_titles`, texto alternativo | filtros num único `bool/must` (cláusulas irmãs dão HTTP 400) |
| Cleveland | `artists=` (com fallback para `q`) | `q` + descrição | `q` | `cc0=1` garante domínio público |
| V&A | `q_actor=` (com fallback) | `q` | `q` | ordenação padrão por relevância |
| SMK | nome | **rótulo dinamarquês** (`impressionisme`) | **rótulo dinamarquês** (`kat`) | acervo catalogado em dinamarquês |
| Wikidata | `P170` (criador) | `P135` (movimento) + obras dos artistas do movimento | `P180` (retrata) / `P136` (gênero) | ordenado por sitelinks (fama); imagem via `Special:FilePath` |
| Wellcome | nome | rótulo | rótulo | só imagens (`workType=k`) com licença aberta; traz `subjects` e `genres` |

O SPARQL usa só SPARQL 1.1 padrão (sem `SERVICE wikibase:label`, sem `mwapi`) e rótulos com `LANG IN ("en","mul")`, porque o WDQS está migrando do Blazegraph para o **QLever** (evento de migração em outubro de 2026).

### 3.3 Uma fonte semântica: Wikidata

A maior fonte de precisão: quando a consulta vira uma entidade, o Wikidata devolve obras em que o fato está afirmado — "criador = Van Gogh", "retrata = gato", "movimento = impressionismo" —, e não obras em que a palavra aparece em algum campo. Também preenche lacunas: Vermeer tem poucas obras nos museus com API, e artistas brasileiros como Almeida Júnior não aparecem em nenhum deles, mas as obras estão no Wikidata com imagem no Commons.

### 3.4 Ranquear por evidência (`js/rank.js`)

| Evidência | Relevância |
|---|---|
| Prova estruturada: QID do artista no Met, criador/movimento/tema no Wikidata, etiqueta do Met com o mesmo QID | 1,0 |
| Metadado do museu: campo de artista, `style_titles`, etiquetas de assunto | 0,85–0,97 |
| Título ou descrição mencionam | 0,6–0,9 |
| Oficina, seguidor, cópia ("Workshop of…", "after…") | 0,5 (menos relacionado) |
| Só o período bate | 0,3 (menos relacionado) |
| Nada bate | 0,05 |

`score = relevância × 100 + bônus pequenos` (popularidade, posição na fonte, suporte pedido, alta resolução), de modo que os bônus só reordenam dentro de uma faixa. Resultados com relevância < 0,6 vão para "Less related results". Depois vêm a diversidade (no máximo 3 da mesma fonte a cada 6, se a alternativa estiver a ≤ 8 pontos) e a deduplicação (mesmo QID ou mesmo título + artista; o registro do museu vence a cópia do Wikidata).

Também entraram: cache em memória com colapso de requisições iguais, cache persistente de objetos do Met e das intenções, timeout por fonte, renderização progressiva sem piscar (nós do DOM reaproveitados) e freio no scroll infinito (para de puxar páginas automaticamente depois de duas páginas sem nada relevante).

---

## 4. E os MCPs?

**MCP (Model Context Protocol) é a forma de um assistente de IA (Claude, por exemplo) chamar ferramentas.** Não é algo que uma página estática no navegador consiga usar em tempo de execução: seria preciso um backend com um LLM no meio, o que traz custo, latência (segundos por busca), chave de API e riscos de privacidade, e quebra o princípio do projeto ("sem chaves, sem build").

**O que já existe** (pesquisado em setembro de 2026):

- [cfpramod/open-museum-mcp](https://github.com/cfpramod/open-museum-mcp) — busca federada em Met, Rijksmuseum, Smithsonian, Cleveland, AIC, SMK, Walters, Wellcome, Commons e Europeana. Mescla em **round-robin** (o mesmo problema que o embusca tinha); o enriquecimento via Wikidata está só no roteiro.
- [cyanheads/met-museum-mcp-server](https://github.com/cyanheads/met-museum-mcp-server) — Met, já migrado para o `/v1.1/search`. A documentação de design dele confirmou o que usamos: `artistOrCulture` quebrado, `tags`/`title` funcionando, `medium` sensível a maiúsculas.
- [mikechao/metmuseum-mcp](https://github.com/mikechao/metmuseum-mcp), [r-huijts/rijksmuseum-mcp](https://github.com/r-huijts/rijksmuseum-mcp), [kintopp/rijksmuseum-mcp-plus](https://github.com/kintopp/rijksmuseum-mcp-plus), [cyanheads/smithsonian-mcp-server](https://github.com/cyanheads/smithsonian-mcp-server), [pipeworx-io/mcp-clevelandart](https://github.com/pipeworx-io/mcp-clevelandart).
- **Wikidata MCP** do [Wikidata Embedding Project](https://www.wikidata.org/wiki/Wikidata:Embedding_Project) (Wikimedia Deutschland + Jina AI + DataStax): busca vetorial semântica + SPARQL para LLMs.

**Recomendação:**

1. **Na página, não.** A camada de entendimento via Wikidata entrega o grosso do ganho que um LLM traria (desambiguação, tradução PT→EN, relações artista ↔ movimento ↔ obra ↔ tema) em ~300 ms, de graça e sem backend.
2. **No desenvolvimento, sim.** Usar os MCPs de museus e do Wikidata no Claude Code para explorar os acervos e para rodar um "LLM como juiz" que audita a suíte de relevância com amostras maiores do que os oráculos em regex cobrem.
3. **Como produto, sim (próximo passo).** Publicar o motor do embusca como servidor MCP (`embusca-mcp`: `search_artworks`, `resolve_query`, `get_artwork`). O diferencial em relação ao open-museum-mcp é justamente o entendimento via Wikidata e o ranking por evidência. O motor já roda no Node, então o servidor seria uma camada fina.
4. **Futuro:** a busca vetorial do Wikidata para consultas descritivas ("pinturas de gatos dormindo") como mais uma variante de resolução.

---

## 5. As duas features

### Feature 1 — Painel de contexto ("o que o embusca entendeu")

Acima dos resultados aparecem o tipo (Artista / Movimento / Gênero / Assunto / Lugar / Obra), o nome canônico, as datas, a descrição, um resumo da Wikipedia **em português quando a busca é em português**, e o link para o Wikidata. Abaixo vêm dois conjuntos de atalhos:

- **Explorar:** do artista para os movimentos dele (Van Gogh → Pós-impressionismo); do movimento para os artistas (Impressionismo → Monet, Renoir, Degas…); da obra para "mais do mesmo autor".
- **Não era isso?** Outras leituras possíveis (Theo van Gogh, por exemplo) e "buscar as palavras exatas". Os atalhos fixam a entidade na URL (`&pin=Q…`).

*Por quê:* torna a busca transparente. Quando o sistema erra a interpretação, o usuário corrige com um clique, e a navegação vira exploração.

### Feature 2 — Linha do tempo

O botão "Grid | Timeline" reorganiza os resultados relevantes cronologicamente. O agrupamento se adapta à dispersão das datas: ano a ano para carreiras curtas (Van Gogh, 1881–1890), quinquênios ou décadas para carreiras longas, quartos de século para movimentos e séculos para temas amplos. As datas vêm dos campos estruturados de cada museu (`date_start`, `creation_date_earliest`, `objectBeginDate`, ISO do SMK/Wikidata) ou de um parser de datas livres ("ca. 1665–67", "late 19th century", "século XIX", "1800-tallet").

*Por quê:* para autor e estilo, que são exatamente os casos do objetivo, ver a evolução no tempo é a pergunta seguinte natural.

Extras menores: "Why shown" no detalhe da obra (o motivo da relevância), "More like this" por artista/assunto/época, URL compartilhável, navegação por teclado e layout mobile sem rolagem horizontal.

---

## 6. Metas e critérios de aceitação

| Critério | Meta |
|---|---|
| Relevantes entre os 6 primeiros (P@6) | **6/6** em cada consulta da suíte |
| Relevantes na lista principal | **≥ 6** por consulta |
| Consultas em português | mesmo desempenho das em inglês |
| Degradação | sem Wikidata, o léxico mantém PT funcionando; uma fonte fora não derruba a busca |
| Compatibilidade | abre via `file://`; sem build, sem chaves, sem dependências em tempo de execução |
| Testes | `npm test` (offline) verde; `npm run test:ui` verde; `npm run test:live` com todas as consultas em PASS |

A suíte cobre **autor** (van gogh, Claude Monet, rembrandt, hokusai, vermeer, Almeida Júnior, "pinturas de Monet"), **tema** (cats, gatos, cavalos, flores, the sea, natureza morta, retrato) e **estilo** (impressionism, impressionismo, barroco, ukiyo-e, pontilhismo, art nouveau, romantismo), além das três consultas do diagnóstico original (brazil, van gogh, medieval). Os oráculos que decidem o que é relevante foram escritos à parte do ranqueador (regex e listas de artistas próprias), para medir o ranking em vez de concordar com ele.

---

## 7. Resultados até aqui

- **Offline:** 43/43 testes passando (utilitários, entendimento, ranking, integração ponta a ponta com respostas no formato real de cada API). No mundo simulado, P@6 foi **6/6** para "van gogh", "gatos" e "impressionismo" com o motor novo, contra **0/6** nas três com o merge antigo.
- **Navegador (Chromium headless, rede simulada):** 8/8 verificações (painel de contexto, linha do tempo ano a ano, modal por teclado com "Why shown", busca em PT, chip de palavras exatas, chip de artista do movimento, suíte rodando dentro da página, mobile a 380 px sem rolagem horizontal).
- **Ao vivo:** **ainda não executado.** A política de rede do ambiente em nuvem onde este trabalho foi feito bloqueia os hosts dos museus e do Wikidata (HTTP 403 no proxy). O runner foi exercitado mesmo assim: o léxico entendeu "gatos" sem Wikidata e cada fonte bloqueada foi reportada. Para medir de verdade: `npm run test:compare` numa máquina com internet, ou "run diagnostics" na página. Veja [`RELEVANCIA.md`](RELEVANCIA.md).

---

## 8. Roteiro

**Feito (fases 1–3):** migração do Met; entendimento via Wikidata + léxico; adaptadores direcionados; fonte Wikidata; ranking por evidência; as duas features; suíte de relevância; testes offline e de interface; correções de segurança, acessibilidade e bugs.

**Próximos passos:**

1. **Calibrar com dados reais:** rodar `npm run test:compare` e ajustar limiar e pesos onde houver falhas. Os pesos estão concentrados em `js/rank.js`.
2. **Rijksmuseum** (nova API Linked Art sem chave) e, opcionalmente, **Europeana** (com chave fornecida pelo usuário), para cobrir melhor a arte holandesa e a europeia.
3. **`embusca-mcp`**: expor o motor como servidor MCP.
4. **Filtros** por século e suporte usando os campos de ano e classificação que já estão normalizados.
5. **Acompanhar a migração do WDQS para o QLever** e trocar o endpoint quando o WDQS v2 virar o padrão (o SPARQL já é compatível).

## 9. Riscos e limitações conhecidas

- **Direitos autorais:** artistas com obra protegida (Tarsila do Amaral, Picasso, Frida Kahlo) têm poucas ou nenhuma imagem aberta. O entendimento funciona, mas pode haver menos de 6 obras com imagem. Não há como contornar isso respeitando as licenças.
- **WDQS em migração:** se o SPARQL falhar, a fonte Wikimedia cai para a busca por texto no Commons, e a classificação cai para a heurística pelas descrições.
- **Bloqueios de rede:** o CDN de imagens do AIC recusa algumas redes (detectado e tratado), e o Met tem proteção contra bots. Timeouts por fonte evitam que uma fonte lenta segure a busca.
- **Cobertura do Wikidata é desigual:** `P180` (retrata) e `P135` (movimento) estão bem preenchidos para obras famosas e menos para acervos menores. Por isso os museus continuam sendo consultados em paralelo.
