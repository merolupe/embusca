# Prompt-mestre — busca relevante no embusca

> Cole o bloco abaixo num agente de IA (Claude Code, por exemplo) ou entregue a quem for manter o projeto. Ele transcreve **todas** as especificações que levam ao objetivo "pelo menos 6 resultados relevantes, e os 6 primeiros todos relevantes, para buscas por autor, tema e estilo". O código atual do repositório já implementa esta especificação; use o prompt para evoluir, reimplementar ou auditar.

---

```text
Você é engenheiro(a) responsável pelo embusca, uma busca unificada de arte em
acervos abertos de museus. Trabalhe no repositório atual. Leia docs/PLANO.md e
o código antes de mudar qualquer coisa.

## 1. Objetivo mensurável
Para cada consulta de autor, tema ou estilo — em inglês OU português — a busca
deve:
  (a) exibir pelo menos 6 obras relevantes na lista principal; e
  (b) ter os 6 primeiros resultados exibidos todos relevantes (P@6 = 6/6).
"Relevante" é decidido pelos oráculos de js/suite.js, que NÃO podem reutilizar
a lógica de js/rank.js (listas e regex próprias).

## 2. Restrições inegociáveis
- Página estática: abre por file://, GitHub Pages ou qualquer servidor estático.
  Sem build, sem bundler, sem dependências em tempo de execução, sem chaves de API.
- Scripts clássicos (não ES modules) em js/, carregados em ordem pelo index.html,
  todos presos ao namespace global `Embusca`. O mesmo código precisa rodar no
  Node 22+ para os testes (sem DOM na carga; use feature detection).
- Só APIs públicas com CORS: Met, AIC, Cleveland, V&A, SMK, Wellcome,
  Wikimedia Commons, Wikidata (API + WDQS) e Wikipedia (API de ação).
- Somente obras de acesso aberto / domínio público.
- Interface em inglês; a busca entende português e inglês.
- Nunca: enviar o texto cru a todas as APIs como estratégia principal; mesclar
  por round-robin; usar /public/collection/v1/search do Met (desativado em
  2026-10-01); usar artistOrCulture=true no Met (sempre 0 resultados); usar
  SERVICE wikibase:label ou wikibase:mwapi no SPARQL (o WDQS migra para QLever);
  atribuir HTML não confiável a innerHTML de elemento vivo (use DOMParser).

## 3. Arquitetura (um arquivo por responsabilidade)
js/util.js     texto (fold/norm/tokens, plural EN/PT/DA, frases), datas,
               fetchJson (timeout, abort, retry em rede/429/5xx, cache em
               memória que colapsa requisições iguais), mapLimit, within,
               persistentMap (LRU em localStorage, ausente no Node), esc,
               stripHtml.
js/lexicon.js  vocabulário embutido EN/PT/DA: palavras genéricas, suportes,
               ~90 termos (assuntos, gêneros, movimentos com período),
               artistas-chave de 24 movimentos, lookup tolerante a plural.
js/intent.js   parse → resolve (Wikidata + léxico) → enrich → summary.
js/sources.js  um adaptador por fonte: search(ctx) → { items, done }.
js/rank.js     matcher por intenção, relevância 0..1 com motivo, score,
               diversidade, deduplicação, interleave (só p/ modo legado).
js/search.js   Session: start(), view(), drain(), loadMore(), status().
js/suite.js    consultas de teste + oráculos + runner + judge.
js/app.js      interface (grade, painel de contexto, linha do tempo, modal,
               scroll infinito, URL, diagnóstico).

## 4. Entendimento da consulta (intent.js)
4.1 parse(q):
  - Remova das bordas palavras genéricas/stopwords EN+PT (art, painting(s),
    works, pintura(s), quadro(s), obra(s), arte, de, do, da, the, of…).
    Se uma delas for suporte, guarde `medium` (painting | drawing | print |
    sculpture | photograph).
  - Variantes (no máximo 3): o núcleo; o singular da última palavra
    (gatos→gato, flores→flor, paisagens→paisagem, leões→leão, animais→animal,
    horses→horse, churches→church, ladies→lady); adjetivo→movimento em
    consulta de uma palavra (impressionist→impressionism, cubista→cubismo);
    forma hifenizada só se o léxico conhecer o núcleo (natureza morta →
    natureza-morta); o texto com artigo inicial ("the starry night").
  - lang = 'pt' se houver ã/õ/ç, palavras PT típicas ou navigator.language pt.
4.2 Candidatos no Wikidata:
  - wbsearchentities (type=item, limit=8, origin=*) para cada variante em PT e
    EN; junte por QID, preferindo casamento exato.
  - wbgetentities(ids, props=labels|descriptions|aliases|sitelinks,
    languages=en|pt|da|mul, languagefallback=1); se a API responder erro,
    repita sem "mul". O número de sitelinks mede popularidade.
  - SPARQL de classificação (P31 e P106 dos candidatos), com timeout de 4,5 s;
    se falhar, classifique pela descrição em inglês.
4.3 Tipos (kind):
  - humano (Q5) com ocupação artística (Q1028181 pintor, Q483501 artista,
    Q3391743, Q1281618, Q11569986, Q329439, Q15296811, Q644687, Q33231,
    Q42973, Q5322166, Q16947657, Q1925963, Q7541856, Q18074503, Q10862983,
    Q3303330, Q211423) → artist; humano sem isso → person (tema retratado).
  - Q968159, Q1792644, Q32880, Q2198855, Q11514315 → movement.
  - Q1792379 → genre.   Obras (Q3305213, Q838948, Q860861, Q93184,
    Q11060274, Q179700, Q219423, Q79218, Q15727816, Q18761202) → artwork.
  - Lugares (Q6256, Q3624078, Q515, Q1549591, Q5119, Q3184121, Q485258,
    Q82794, Q5107, Q23442, Q486972, Q107390, Q15284, Q484170, Q200250,
    Q3024240, Q35657, Q1637706) → place.
  - Desambiguação, sobrenome, prenome, filme, musical, álbum, canção, série,
    jogo, banda, livro, artigo científico, empresa, museu… → media (descartado).
  - Demais → subject.
4.4 Pontuação de candidato:
  casamento (exato no núcleo 3 | exato em variante 2,5 | prefixo 1 | outro 0,3)
  + prior do tipo (artist/movement/genre 3, artwork/subject/place 2, person 1,5,
  media −4) + 1,2·log10(1+sitelinks) + 0,08·(8−posição)
  + 3 se o rótulo EN coincide com o termo do léxico.
  Aceite o melhor se casamento ≥ 1 e pontuação ≥ 4,5. Se o léxico reconhecer a
  consulta e o melhor candidato for de outro tipo, prefira um candidato do tipo
  do léxico; sem ele, use a intenção do léxico ("flores" = flor, não a ilha).
  Sem Wikidata nem léxico → kind = free (texto livre).
  `pin=<QID>` força a entidade; `pin=none` força texto livre.
  Guarde de 4 a 5 alternativas (não-media) para o painel "Não era isso?".
  Cache das intenções: 7 dias.
4.5 Enriquecimento (em paralelo às buscas, limite de 5 s):
  artist → P135 (movimentos, rótulo en/mul), P569/P570 (datas de vida);
  movement → artistas com P135 = movimento, ordenados por sitelinks (30),
             unidos aos artistas-semente do léxico; período P580/P582/P571;
  artwork → P170 (autor); place → P1549 (gentílico EN).
  Os artistas-semente entram de forma síncrona, para que o Met já os use.
4.6 summary(): extrato de 3 frases + miniatura pela API de ação da Wikipedia
  (prop=extracts|pageimages), em pt.wikipedia se lang = pt, senão em en.

## 5. Regras por fonte (sources.js) — verificadas em 2026-09
Formato do item: { id, source, title, artist, artistFull, artistQid,
attribution, date, years{start,end}, country, medium, classification,
keywords[], tagQids[], desc, qid, evidence{kind,qid,via}, thumb, hires,
museum, url, pop(0..1), rank }.
Termo enviado: kind=free → núcleo; demais → rótulo canônico em inglês.
- Met: GET /public/collection/v1.1/search?q=&hasImages=true&offset=&limit=
  (≤ 500; janela de 10 000; objectIDs null fora dela) e GET /v1/objects/{id}.
  Plano por tipo, com as variantes de precisão primeiro e a principal paginando:
    artist   → [q=nome&isHighlight=true (24), q=nome]
    movement → [q=rótulo&isHighlight=true, destaques dos 3 primeiros artistas
                do movimento (8 cada), q=rótulo]
    subject/person → [q=termo&tags=true&isHighlight=true, q=termo&tags=true;
                se total < 12, q=termo]
    place    → [destaques, q=lugar&geoLocation=lugar; se total < 12, q=lugar]
    artwork  → [q=título&title=true (12), destaques do autor, q=autor]
    free     → [destaques (12), q=texto]
  Janela de 30 IDs por página, concorrência 6, retry 1. Cache persistente dos
  objetos já normalizados (900 itens, 30 dias). Normalize artistPrefix →
  attribution, artistWikidata_URL → artistQid, tags[].Wikidata_URL → tagQids,
  objectWikidata_URL → qid, isHighlight → pop.
- AIC: /api/v1/artworks/search?q=…&query[bool][must][0][term][is_public_domain]=true
  &query[bool][must][1][exists][field]=image_id&fields=id,title,artist_display,
  artist_title,artist_titles,date_display,date_start,date_end,place_of_origin,
  image_id,medium_display,classification_title,classification_titles,
  style_title,style_titles,subject_titles,term_titles,theme_titles,
  artwork_type_title,thumbnail,is_boosted&limit=40&page=N.
  Imagens: https://www.artic.edu/iiif/2/{image_id}/full/400,/0/default.jpg e
  full/1686,. keywords = estilos+assuntos+termos+classificação; desc = alt_text.
- Cleveland: /api/artworks/?has_image=1&cc0=1&limit=40&skip=…&fields=…
  artist → artists=<nome> (fallback q= se vier vazio); demais → q=.
  Use creation_date_earliest/latest; desc = description sem HTML.
- V&A: /v2/objects/search?images_exist=1&page_size=40&page=N;
  artist → q_actor=<nome> (fallback q=); demais → q=. Pare em info.pages.
- SMK: /api/v1/art/search/?keys=…&filters=[has_image:true],[public_domain:true]
  &rows=40&offset=…; em subject/genre/movement, envie o rótulo DINAMARQUÊS
  (Wikidata "da" ou léxico). Título em inglês quando houver (language
  english/engelsk); todos os títulos entram em keywords.
- Wellcome: /catalogue/v2/works?query=…&workType=k&items.locations.license=
  cc0,pdm&pageSize=40&page=N&include=production,contributors,subjects,genres.
- Wikimedia: com QID e kind ∈ {artist, movement, genre, subject, person,
  place, artwork}, use WDQS (48 por página, ORDER BY DESC(sitelinks)):
    artist   → ?item wdt:P170 Q (exclua cartas Q133492)          via "artist"
    movement → { ?item wdt:P135 Q ; P31 ∈ tipos de arte }         via "style"
               UNION { obras P31 pintura dos 8 artistas do movimento } via "artist"
    genre    → P136 Q ; subject/person → P180 Q (P31 ∈ tipos de arte)
    place    → pinturas com P180 Q  UNION  pinturas de pintores (P106
               Q1028181) com cidadania P27 Q
    artwork  → a própria obra UNION obras do mesmo autor
  sempre com ?item wdt:P18 ?image; rótulos LANG IN ("en","mul") e "pt";
  P571, P170 (rótulo), P195 (coleção, rótulo en).
  Imagem: https://commons.wikimedia.org/wiki/Special:FilePath/<arquivo>?width=400
  (e ?width=2000); ignore svg/pdf/djvu/áudio/vídeo. evidence={kind,qid,via}.
  Sem SPARQL (erro ou esgotado): busca do Commons (generator=search,
  namespace 6, "<termo> painting filetype:bitmap"), descartando mapas,
  diagramas, logos, brasões, bandeiras e páginas de rosto.
Cada adaptador devolve `done` pela paginação REAL da API (nunca pela lista
filtrada). Timeout por fonte: Met 35 s, Wikimedia 25 s, demais 18 s.

## 6. Relevância e ranking (rank.js)
Relevância por tipo (valor, motivo mostrado ao usuário):
  artist:   artistQid = QID ou evidence → 1,0 | nome no campo de artista
            (variantes sem partículas; iniciais aceitas; apelidos de uma
            palavra só com ≥ 5 letras) → 0,97 | qualificador "attributed" →
            0,85 | workshop/circle/follower/school/manner/copy/after/pupil →
            0,5 | nome só no título/keywords → 0,4 | nada → 0,05
  movement: evidence style → 1,0 | via artist → 0,88 | keywords com o rótulo
            ou radical (-ism → -is…) → 0,95 | artista do movimento → 0,85 |
            título → 0,7 | descrição → 0,62 | seguidor → 0,5 | só o período →
            0,3
  genre/subject/person: evidence → 1,0 | tagQids contém o QID → 1,0 |
            keywords → 0,92 | título → 0,9 | descrição → 0,62 (frases do
            rótulo, rótulos PT/DA, aliases e termos do léxico; última palavra
            tolerante a plural; nunca substring: "Catskill" ≠ cat)
  place:    evidence depicts 1,0 / artist 0,9 | campo de origem 0,9 | título
            0,85 | gentílico na biografia 0,85 | keywords 0,75 | descrição 0,6
  artwork:  mesma obra (qid) 1,0 | título ≥ 80% + autor 0,98 | mesmo autor
            0,8 | mesmo título 0,6
  free:     todas as palavras em título/artista/keywords 0,9; todas em
            qualquer campo 0,65; parcial 0,55 × cobertura
score = 100·relevância + 6·pop + 5·(1 − min(rank,60)/60)
        + (suporte pedido: +5 se bate, −3 se o item informa outro)
        + (sem suporte pedido e kind ∉ {free, place}: +2 se pintura)
        + 1 se tem alta resolução
Lista principal: relevância ≥ 0,6, ordenada por score e diversificada (no
máximo 3 da mesma fonte a cada 6, se a alternativa estiver a ≤ 8 pontos).
Resto: "Less related results", ordenado por score, recolhido.
Deduplicação por QID e por (título normalizado | nome do artista sem
partículas, ordenado); preferência met=aic=cma > smk=vam > wel > wmc.
Modo legado (só para comparação): texto cru + round-robin, sem limiar.

## 7. Sessão (search.js)
Session(query, { sources, pin, legacy, onUpdate }). start(): resolve →
emit('intent') → enrich em paralelo (emit 'enriched') → página 1 de todas as
fontes em paralelo (emit 'source' a cada uma) → emit('done'). view() ranqueia
tudo e marca como exibido; drain() ranqueia só o que ainda não foi exibido,
descartando duplicatas do que já está na tela; loadMore() busca a próxima
página das fontes ativas. abort() cancela tudo.

## 8. Interface (index.html + app.js)
- Enquanto o usuário não rolou nem abriu nada, cada atualização reordena a
  primeira página; depois, os itens novos são só anexados. Reaproveite os nós
  do DOM por id (replaceChildren) para as imagens não recarregarem.
- Status por fonte: "N works · M relevant", "searching…" ou "unavailable
  (motivo)"; aviso de CDN do AIC bloqueado (sonda de imagem única).
- FEATURE 1 — Painel de contexto: tipo, rótulo (+ rótulo PT se a busca for PT),
  datas de vida ou período, descrição (PT se houver), resumo da Wikipedia com
  miniatura e link, link Wikidata; "Explore" (artista → movimentos; movimento
  → até 8 artistas; obra → "More by <autor>"); "Not what you meant?"
  (alternativas + "Search the exact words instead"; em texto livre fixado,
  "Interpret … instead"). Chips fazem runSearch(q, { pin }).
- FEATURE 2 — Linha do tempo: alterna com a grade; agrupa os relevantes pelo
  ponto médio de years, com intervalo pela dispersão (≤15 anos: ano; ≤40:
  5 anos; ≤100: década; ≤400: 25 anos; mais: século, com BCE); "Undated" no
  fim; cartões clicáveis e acessíveis.
- Detalhe: miniatura → alta resolução só se carregar; fatos + "Why shown"
  (motivo da relevância); "More like this" por artista/QID, keywords e década;
  foco no botão de fechar e devolução do foco ao sair; Esc fecha.
- URL: ?q=…&pin=… com pushState/popstate (try/catch em file://). ?autotest=1
  roda o diagnóstico.
- Scroll infinito: IntersectionObserver + scroll + poll leve; pare de puxar
  automaticamente depois de 2 páginas sem nenhum item relevante (o botão
  continua).
- Acessibilidade: cartões com tabindex/role/aria-label, Enter/Espaço, foco
  visível. Mobile: margens de 16 px, sem rolagem horizontal a 380 px.
- Bandeiras por regex com \b; frases continentais ("latin american") sem
  bandeira.

## 9. Suíte e testes
Consultas (js/suite.js): autor = van gogh, Claude Monet, rembrandt, hokusai,
vermeer, Almeida Júnior, pinturas de Monet; tema = cats, gatos, cavalos,
flores, the sea, natureza morta, retrato; estilo = impressionism,
impressionismo, barroco, ukiyo-e, pontilhismo, art nouveau, romantismo;
legado = brazil, van gogh, medieval.
Veredito: PASS se P@6 = 6 e relevantes na lista principal ≥ 6; WARN se
P@6 ≥ 5; senão FAIL.
Comandos:
  npm test              offline: util, intent, rank e integração ponta a
                        ponta com tests/fixtures/world.js (respostas no formato
                        real, misturando relevantes e irrelevantes)
  npm run test:ui       Chromium headless com rede simulada (Playwright)
  npm run test:live     suíte ao vivo contra as APIs reais
  npm run test:compare  motor novo × merge antigo (relatório em tests/report/)
  Na página: "run diagnostics" ou ?autotest=1 (inclui a checagem de imagens).
Adicione um teste para cada bug corrigido.

## 10. Definição de pronto
[ ] npm test e npm run test:ui verdes
[ ] npm run test:live: todas as consultas de autor/tema/estilo em PASS; se
    alguma falhar por falta de acervo aberto (direitos autorais), documente em
    docs/RELEVANCIA.md em vez de afrouxar o oráculo
[ ] nenhuma chamada a /v1/search do Met, nem artistOrCulture, nem label service
[ ] a página abre via file:// e funciona em 380 px de largura
[ ] README e docs/RELEVANCIA.md atualizados com os números da última execução
```

---

## Como usar este prompt

- **Para evoluir:** acrescente no fim do bloco o que quer mudar (por exemplo: "adicione o Rijksmuseum como oitava fonte seguindo a seção 5") e peça o mesmo padrão: adaptador → testes com fixture → suíte ao vivo.
- **Para auditar:** peça "verifique item por item as seções 2 a 10 contra o código e liste as divergências".
- **Para recalibrar:** rode `npm run test:compare`, cole o relatório e peça para ajustar só os pesos da seção 6 até todas as consultas passarem, sem mexer nos oráculos.
