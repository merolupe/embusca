/* ============================================================
   embusca — built-in art vocabulary (EN / PT / DA)
   Works offline: when Wikidata is slow or down, this still turns
   "gatos", "natureza morta" or "impressionismo" into the English
   terms the museum APIs understand, and gives the ranker synonyms.
   `en` is the English Wikidata label (folded) so both can be merged.
   Danish (`da`) is what SMK's metadata is written in.
   ============================================================ */
(function (root) {
  'use strict';
  const EB = root.Embusca = root.Embusca || {};
  const U = EB.util;

  // Words stripped from the edges of a query: "pinturas de van gogh" -> "van gogh".
  const GENERIC = new Set([
    'art', 'arts', 'artwork', 'artworks', 'artist', 'artists', 'painting', 'paintings', 'painter',
    'painters', 'work', 'works', 'piece', 'pieces', 'picture', 'pictures', 'image', 'images',
    'drawing', 'drawings', 'print', 'prints', 'sculpture', 'sculptures', 'photo', 'photos',
    'photograph', 'photographs', 'style', 'movement', 'period', 'famous', 'best', 'museum',
    'arte', 'artes', 'obra', 'obras', 'quadro', 'quadros', 'pintura', 'pinturas', 'pintor',
    'pintora', 'pintores', 'tela', 'telas', 'desenho', 'desenhos', 'gravura', 'gravuras',
    'escultura', 'esculturas', 'foto', 'fotos', 'fotografia', 'fotografias', 'estilo',
    'movimento', 'periodo', 'famoso', 'famosa', 'famosos', 'famosas', 'imagem', 'imagens',
  ]);

  // Medium named in the query, and how to recognise it on an item.
  const MEDIUM = [
    { key: 'painting', words: ['painting', 'paintings', 'pintura', 'pinturas', 'quadro', 'quadros', 'tela', 'telas', 'oleo', 'oil'],
      test: /\bpaint|oil on|tempera|acrylic|gouache|fresco|maleri|pintura|\boil\b/ },
    { key: 'drawing', words: ['drawing', 'drawings', 'desenho', 'desenhos', 'sketch', 'sketches', 'esboco'],
      test: /drawing|sketch|pencil|chalk|charcoal|pen and|graphite|tegning|desenho/ },
    { key: 'print', words: ['print', 'prints', 'gravura', 'gravuras', 'woodcut', 'xilogravura', 'etching', 'etchings', 'lithograph'],
      test: /print|etching|engraving|woodcut|woodblock|lithograph|mezzotint|aquatint|grafik|gravura|ukiyo/ },
    { key: 'sculpture', words: ['sculpture', 'sculptures', 'escultura', 'esculturas', 'statue', 'estatua'],
      test: /sculpt|statue|statuette|bronze|marble|skulptur|escultura/ },
    { key: 'photograph', words: ['photo', 'photos', 'photograph', 'photographs', 'foto', 'fotos', 'fotografia', 'fotografias'],
      test: /photo|albumen|gelatin silver|daguerreotype|fotografi/ },
  ];

  // kind: subject | genre | movement. years: movement period (weak date signal).
  const TERMS = [
    // ---- subjects ----
    { kind: 'subject', en: 'cat', pt: ['gato', 'gata', 'gatos', 'gatas', 'gatinho', 'gatinhos', 'felino'], da: ['kat', 'katte'], rel: ['kitten', 'kittens', 'feline'] },
    { kind: 'subject', en: 'dog', pt: ['cachorro', 'cachorros', 'cao', 'caes', 'cadela'], da: ['hund', 'hunde'], rel: ['puppy', 'puppies', 'hound', 'hounds', 'spaniel', 'poodle'] },
    { kind: 'subject', en: 'horse', pt: ['cavalo', 'cavalos', 'egua', 'eguas', 'equino'], da: ['hest', 'heste'], rel: ['equestrian', 'stallion', 'mare', 'pony', 'ponies', 'horseman', 'horsemen', 'cavalry', 'rider'] },
    { kind: 'subject', en: 'bird', pt: ['passaro', 'passaros', 'ave', 'aves', 'passarinho'], da: ['fugl', 'fugle'], rel: ['sparrow', 'parrot', 'owl', 'crane', 'heron', 'dove', 'swan', 'peacock', 'eagle', 'rooster', 'hen', 'duck'] },
    { kind: 'subject', en: 'flower', pt: ['flor', 'flores', 'floral', 'buque', 'ramalhete'], da: ['blomst', 'blomster', 'buket'], rel: ['bouquet', 'floral', 'rose', 'tulip', 'lily', 'peony', 'iris', 'irises', 'sunflower', 'blossom', 'poppy', 'chrysanthemum', 'daisy', 'daisies', 'carnation', 'lotus', 'orchid', 'camellia', 'anemone', 'magnolia', 'hydrangea'] },
    { kind: 'subject', en: 'tree', pt: ['arvore', 'arvores'], da: ['træ', 'træer'], rel: ['forest', 'woods', 'oak', 'pine', 'cypress', 'cypresses', 'willow', 'birch', 'olive trees', 'orchard'] },
    { kind: 'subject', en: 'sea', pt: ['mar', 'mares', 'oceano', 'marinha'], da: ['hav', 'havet'], rel: ['seascape', 'ocean', 'marine', 'coast', 'coastal', 'shore', 'beach', 'wave', 'harbor', 'harbour', 'ship', 'boat', 'sailing', 'bay', 'cliff', 'surf'] },
    { kind: 'subject', en: 'river', pt: ['rio', 'rios'], da: ['flod', 'floder'], rel: ['stream', 'riverbank', 'canal', 'bridge'] },
    { kind: 'subject', en: 'mountain', pt: ['montanha', 'montanhas', 'serra', 'monte'], da: ['bjerg', 'bjerge'], rel: ['alps', 'peak', 'mount', 'valley', 'hills'] },
    { kind: 'subject', en: 'night', pt: ['noite', 'noturno', 'noturna'], da: ['nat', 'natten'], rel: ['nocturne', 'moonlight', 'moon', 'stars', 'starry', 'evening'] },
    { kind: 'subject', en: 'winter', pt: ['inverno', 'neve'], da: ['vinter', 'sne'], rel: ['snow', 'snowy', 'ice', 'skating', 'frost'] },
    { kind: 'subject', en: 'garden', pt: ['jardim', 'jardins'], da: ['haveanlæg'], rel: ['park', 'orchard'] },
    { kind: 'subject', en: 'fruit', pt: ['fruta', 'frutas', 'fruto', 'frutos'], da: ['frugt'], rel: ['apple', 'grapes', 'pear', 'peach', 'lemon', 'orange', 'cherries', 'melon'] },
    { kind: 'subject', en: 'ship', pt: ['navio', 'navios', 'barco', 'barcos', 'embarcacao', 'embarcacoes'], da: ['skib', 'skibe'], rel: ['boat', 'vessel', 'sailing', 'frigate', 'harbor', 'harbour'] },
    { kind: 'subject', en: 'church', pt: ['igreja', 'igrejas', 'catedral', 'capela'], da: ['kirke', 'kirker', 'katedral'], rel: ['cathedral', 'chapel', 'abbey', 'basilica'] },
    { kind: 'subject', en: 'city', pt: ['cidade', 'cidades'], da: ['bybillede'], rel: ['town', 'street', 'square', 'cityscape'] },
    { kind: 'subject', en: 'woman', pt: ['mulher', 'mulheres', 'moca', 'dama', 'damas'], da: ['kvinde', 'kvinder'], rel: ['women', 'lady', 'ladies', 'girl', 'madame'] },
    { kind: 'subject', en: 'child', pt: ['crianca', 'criancas', 'menino', 'menina', 'meninos', 'meninas'], da: ['børnene'], rel: ['children', 'boy', 'girl', 'infant', 'baby'] },
    { kind: 'subject', en: 'dance', pt: ['danca', 'dancas', 'dancarina', 'dancarino', 'bailarina', 'bailarinas', 'bale'], da: ['dans', 'danser'], rel: ['dancer', 'dancers', 'ballet', 'ballerina', 'dancing'] },
    { kind: 'subject', en: 'music', pt: ['musica', 'musico', 'musicos', 'instrumento'], da: ['musik', 'musiker'], rel: ['musician', 'guitar', 'violin', 'lute', 'piano', 'flute', 'singer', 'concert'] },
    { kind: 'subject', en: 'death', pt: ['morte', 'caveira', 'cranio', 'vanitas'], da: ['døden', 'kranie'], rel: ['skull', 'vanitas', 'dead', 'dying', 'memento mori', 'grave', 'funeral'] },
    { kind: 'subject', en: 'angel', pt: ['anjo', 'anjos', 'querubim'], da: ['engel', 'engle'], rel: ['cherub', 'putti', 'putto', 'annunciation'] },
    { kind: 'subject', en: 'crucifixion', pt: ['crucificacao', 'crucifixo', 'cristo crucificado'], da: ['korsfæstelse', 'korsfæstelsen'], rel: ['crucified', 'christ on the cross', 'calvary'] },
    { kind: 'subject', en: 'battle', pt: ['batalha', 'batalhas', 'guerra', 'combate'], da: ['slag', 'krig'], rel: ['war', 'soldiers', 'army', 'combat', 'siege'] },
    { kind: 'subject', en: 'love', pt: ['amor', 'beijo', 'casal', 'amantes'], da: ['kærlighed', 'kys'], rel: ['lovers', 'kiss', 'couple', 'courtship', 'cupid'] },
    { kind: 'subject', en: 'lion', pt: ['leao', 'leoes'], da: ['løver'], rel: ['lioness', 'lions'] },
    { kind: 'subject', en: 'butterfly', pt: ['borboleta', 'borboletas'], da: ['sommerfugl', 'sommerfugle'], rel: ['moth'] },
    { kind: 'subject', en: 'fish', pt: ['peixe', 'peixes'], da: ['fisk'], rel: ['carp', 'fishing'] },
    { kind: 'subject', en: 'moon', pt: ['lua', 'luar'], da: ['månen'], rel: ['moonlight', 'moonrise', 'crescent'] },
    { kind: 'subject', en: 'bridge', pt: ['ponte', 'pontes'], da: ['bro', 'broer'], rel: [] },
    { kind: 'subject', en: 'beach', pt: ['praia', 'praias'], da: ['stranden'], rel: ['seashore', 'bathers', 'dunes'] },
    { kind: 'subject', en: 'cow', pt: ['vaca', 'vacas', 'gado', 'boi', 'bois'], da: ['køer', 'kvæg'], rel: ['cattle', 'ox', 'oxen', 'bull', 'herd'] },
    { kind: 'subject', en: 'sheep', pt: ['ovelha', 'ovelhas', 'carneiro'], da: ['lam'], rel: ['lamb', 'shepherd', 'flock'] },
    { kind: 'subject', en: 'rabbit', pt: ['coelho', 'coelhos', 'lebre'], da: ['kanin', 'hare'], rel: ['hare'] },
    { kind: 'subject', en: 'owl', pt: ['coruja', 'corujas'], da: ['ugle', 'ugler'], rel: [] },
    { kind: 'subject', en: 'monkey', pt: ['macaco', 'macacos'], da: ['aberne'], rel: ['ape'] },
    { kind: 'subject', en: 'dragon', pt: ['dragao', 'dragoes'], da: ['drage', 'drager'], rel: [] },
    { kind: 'subject', en: 'storm', pt: ['tempestade', 'tempestades'], da: ['storm', 'uvejr'], rel: ['tempest', 'shipwreck', 'thunderstorm'] },
    { kind: 'subject', en: 'animal', pt: ['animal', 'animais', 'bicho', 'bichos'], da: ['dyr'], rel: ['beast', 'beasts'] },
    // ---- genres ----
    { kind: 'genre', en: 'portrait', pt: ['retrato', 'retratos'], da: ['portræt', 'portrætter'], rel: ['self-portrait', 'bust', 'likeness'] },
    { kind: 'genre', en: 'self-portrait', pt: ['autorretrato', 'autorretratos', 'auto-retrato'], da: ['selvportræt'], rel: ['self portrait'] },
    { kind: 'genre', en: 'landscape painting', alt: ['landscape', 'landscape art'], pt: ['paisagem', 'paisagens', 'pintura de paisagem'], da: ['landskab', 'landskaber', 'landskabsmaleri'], rel: ['view', 'countryside', 'scenery', 'valley', 'vista', 'panorama'] },
    { kind: 'genre', en: 'still life', alt: ['still-life'], pt: ['natureza-morta', 'natureza morta', 'naturezas-mortas', 'naturezas mortas'], da: ['opstilling', 'stilleben'], rel: ['nature morte', 'stilleven', 'vanitas', 'bodegon'] },
    { kind: 'genre', en: 'marine art', alt: ['seascape', 'marine painting'], pt: ['marinha', 'marinhas', 'paisagem marinha'], da: ['marinemaleri', 'mariner'], rel: ['seascape', 'marine', 'ships'] },
    { kind: 'genre', en: 'history painting', pt: ['pintura historica', 'pintura de historia'], da: ['historiemaleri'], rel: ['historical'] },
    { kind: 'genre', en: 'genre painting', alt: ['genre art'], pt: ['pintura de genero', 'cena de genero', 'cotidiano'], da: ['genremaleri'], rel: ['genre scene', 'everyday life', 'peasants', 'tavern'] },
    { kind: 'genre', en: 'nude', alt: ['nude art'], pt: ['nu', 'nus', 'nu artistico'], da: ['akt', 'nøgen'], rel: ['nudes', 'naked', 'bather', 'bathers'] },
    { kind: 'genre', en: 'cityscape', pt: ['paisagem urbana', 'vista urbana', 'vista da cidade'], da: ['bybillede', 'prospekt'], rel: ['view of', 'city view', 'veduta', 'vedute', 'street'] },
    { kind: 'genre', en: 'interior', pt: ['interior', 'interiores'], da: ['interiør'], rel: ['interiors', 'room'] },
    { kind: 'genre', en: 'religious art', pt: ['arte sacra', 'arte religiosa'], da: ['religiøs kunst'], rel: ['religious', 'altarpiece', 'madonna', 'saint'] },
    // ---- movements / styles / periods ----
    { kind: 'movement', en: 'impressionism', pt: ['impressionismo', 'impressionista', 'impressionistas'], da: ['impressionisme'], rel: ['impressionist', 'impressionists'], stem: 'impressionis', years: [1860, 1900] },
    { kind: 'movement', en: 'post-impressionism', pt: ['pos-impressionismo', 'pos impressionismo', 'pos-impressionista'], da: ['postimpressionisme'], rel: ['post-impressionist', 'postimpressionism'], years: [1886, 1910] },
    { kind: 'movement', en: 'pointillism', pt: ['pontilhismo', 'pontilhista'], da: ['pointillisme'], rel: ['pointillist', 'neo-impressionism', 'neo-impressionist', 'divisionism'], stem: 'pointill', years: [1884, 1910] },
    { kind: 'movement', en: 'expressionism', pt: ['expressionismo', 'expressionista'], da: ['ekspressionisme'], rel: ['expressionist', 'die brucke', 'der blaue reiter'], stem: 'expressionis', years: [1905, 1935] },
    { kind: 'movement', en: 'cubism', pt: ['cubismo', 'cubista'], da: ['kubisme'], rel: ['cubist'], stem: 'cubis', years: [1907, 1925] },
    { kind: 'movement', en: 'fauvism', pt: ['fauvismo', 'fauvista'], da: ['fauvisme'], rel: ['fauve', 'fauves', 'fauvist'], years: [1904, 1910] },
    { kind: 'movement', en: 'surrealism', pt: ['surrealismo', 'surrealista'], da: ['surrealisme'], rel: ['surrealist'], stem: 'surreal', years: [1920, 1970] },
    { kind: 'movement', en: 'romanticism', pt: ['romantismo', 'romantico', 'romantica'], da: ['romantik', 'romantikken'], rel: ['romantic'], stem: 'romantic', years: [1790, 1850] },
    { kind: 'movement', en: 'realism', pt: ['realismo', 'realista'], da: ['realisme'], rel: ['realist'], years: [1840, 1890] },
    { kind: 'movement', en: 'baroque', pt: ['barroco', 'barroca'], da: ['barok', 'barokken'], rel: ['baroque art'], years: [1600, 1750] },
    { kind: 'movement', en: 'rococo', pt: ['rococo'], da: ['rokoko'], rel: [], years: [1720, 1790] },
    { kind: 'movement', en: 'renaissance', pt: ['renascimento', 'renascentista', 'renascenca'], da: ['renæssance', 'renæssancen'], rel: ['high renaissance', 'early renaissance', 'quattrocento', 'cinquecento'], years: [1400, 1600] },
    { kind: 'movement', en: 'mannerism', pt: ['maneirismo', 'maneirista'], da: ['manierisme'], rel: ['mannerist'], years: [1520, 1600] },
    { kind: 'movement', en: 'neoclassicism', pt: ['neoclassicismo', 'neoclassico'], da: ['nyklassicisme', 'klassicisme'], rel: ['neoclassical', 'neoclassic'], years: [1750, 1830] },
    { kind: 'movement', en: 'symbolism', pt: ['simbolismo', 'simbolista'], da: ['symbolisme'], rel: ['symbolist'], years: [1880, 1910] },
    { kind: 'movement', en: 'art nouveau', pt: ['art nouveau', 'arte nova'], da: ['skønvirke', 'jugendstil'], rel: ['jugendstil', 'secession', 'liberty style'], years: [1890, 1914] },
    { kind: 'movement', en: 'art deco', pt: ['art deco'], da: ['art deco'], rel: [], years: [1910, 1940] },
    { kind: 'movement', en: 'ukiyo-e', alt: ['ukiyoe'], pt: ['ukiyo-e', 'ukiyoe', 'gravura japonesa', 'xilogravura japonesa'], da: ['japanske træsnit'], rel: ['ukiyo', 'nishiki-e', 'surimono', 'floating world'], years: [1650, 1900] },
    { kind: 'movement', en: 'pre-raphaelite brotherhood', alt: ['pre-raphaelites', 'pre-raphaelite'], pt: ['pre-rafaelitas', 'pre-rafaelita', 'irmandade pre-rafaelita'], da: ['prerafaelitterne'], rel: ['pre-raphaelite'], years: [1848, 1900] },
    { kind: 'movement', en: 'danish golden age', pt: ['era de ouro dinamarquesa', 'idade de ouro dinamarquesa'], da: ['guldalderen', 'dansk guldalder', 'guldalder'], rel: ['golden age'], years: [1800, 1850] },
    { kind: 'movement', en: 'dutch golden age painting', alt: ['dutch golden age'], pt: ['seculo de ouro holandes', 'era de ouro holandesa'], da: ['hollandsk guldalder'], rel: ['dutch golden age'], years: [1588, 1672] },
    { kind: 'movement', en: 'hudson river school', pt: ['escola do rio hudson'], da: [], rel: [], years: [1825, 1880] },
    { kind: 'movement', en: 'barbizon school', pt: ['escola de barbizon'], da: ['barbizonskolen'], rel: ['barbizon'], years: [1830, 1870] },
    { kind: 'movement', en: 'academic art', pt: ['academicismo', 'arte academica'], da: ['akademisk kunst'], rel: ['academic', 'academicism'], years: [1800, 1900] },
    { kind: 'movement', en: 'gothic art', alt: ['gothic'], pt: ['arte gotica', 'gotico', 'gotica'], da: ['gotik', 'gotisk kunst'], rel: ['gothic'], years: [1150, 1500] },
    { kind: 'movement', en: 'medieval art', alt: ['medieval', 'middle ages'], pt: ['arte medieval', 'medieval', 'idade media'], da: ['middelalderkunst', 'middelalder'], rel: ['medieval', 'middle ages', 'romanesque', 'gothic', 'byzantine'], years: [500, 1500] },
  ];

  // Core artists per movement: fallback when Wikidata's list is unavailable,
  // and a strong prior for museums without style metadata (Met, CMA, V&A).
  const MOVEMENT_ARTISTS = {
    'impressionism': ['Claude Monet', 'Pierre-Auguste Renoir', 'Edgar Degas', 'Camille Pissarro', 'Alfred Sisley', 'Berthe Morisot', 'Mary Cassatt', 'Gustave Caillebotte', 'Frédéric Bazille', 'Armand Guillaumin', 'Édouard Manet', 'Eva Gonzalès', 'Childe Hassam', 'Theodore Robinson', 'John Henry Twachtman'],
    'post-impressionism': ['Vincent van Gogh', 'Paul Cézanne', 'Paul Gauguin', 'Georges Seurat', 'Henri de Toulouse-Lautrec', 'Paul Signac', 'Émile Bernard', 'Henri Rousseau', 'Pierre Bonnard', 'Édouard Vuillard'],
    'pointillism': ['Georges Seurat', 'Paul Signac', 'Henri-Edmond Cross', 'Maximilien Luce', 'Théo van Rysselberghe', 'Charles Angrand', 'Albert Dubois-Pillet', 'Hippolyte Petitjean', 'Lucien Pissarro'],
    'expressionism': ['Edvard Munch', 'Ernst Ludwig Kirchner', 'Egon Schiele', 'Franz Marc', 'Wassily Kandinsky', 'Emil Nolde', 'August Macke', 'Max Beckmann', 'Oskar Kokoschka', 'Karl Schmidt-Rottluff', 'Erich Heckel', 'Paula Modersohn-Becker'],
    'cubism': ['Pablo Picasso', 'Georges Braque', 'Juan Gris', 'Fernand Léger', 'Albert Gleizes', 'Jean Metzinger', 'Robert Delaunay', 'Louis Marcoussis'],
    'fauvism': ['Henri Matisse', 'André Derain', 'Maurice de Vlaminck', 'Raoul Dufy', 'Albert Marquet', 'Kees van Dongen', 'Henri Manguin', 'Charles Camoin', 'Othon Friesz'],
    'surrealism': ['Salvador Dalí', 'René Magritte', 'Max Ernst', 'Joan Miró', 'Yves Tanguy', 'Giorgio de Chirico', 'Leonora Carrington', 'André Masson', 'Paul Delvaux'],
    'romanticism': ['Eugène Delacroix', 'Théodore Géricault', 'J. M. W. Turner', 'John Constable', 'Caspar David Friedrich', 'Francisco Goya', 'William Blake', 'Henry Fuseli', 'Thomas Cole', 'Antoine-Jean Gros', 'Johan Christian Dahl', 'Philipp Otto Runge'],
    'realism': ['Gustave Courbet', 'Jean-François Millet', 'Honoré Daumier', 'Jean-Baptiste-Camille Corot', 'Rosa Bonheur', 'Ilya Repin', 'Winslow Homer', 'Thomas Eakins', 'Jules Breton', 'Adolph Menzel'],
    'baroque': ['Caravaggio', 'Peter Paul Rubens', 'Rembrandt', 'Diego Velázquez', 'Johannes Vermeer', 'Gian Lorenzo Bernini', 'Anthony van Dyck', 'Artemisia Gentileschi', 'Frans Hals', 'Nicolas Poussin', 'Francisco de Zurbarán', 'Bartolomé Esteban Murillo', 'Jusepe de Ribera', 'Guido Reni', 'Annibale Carracci', 'Guercino', 'Claude Lorrain', 'Jacob Jordaens', 'Georges de La Tour', 'Orazio Gentileschi'],
    'rococo': ['Jean-Antoine Watteau', 'François Boucher', 'Jean-Honoré Fragonard', 'Giovanni Battista Tiepolo', 'Nicolas Lancret', 'Jean-Baptiste Pater', 'Rosalba Carriera', 'Canaletto', 'Pietro Longhi'],
    'renaissance': ['Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Sandro Botticelli', 'Titian', 'Albrecht Dürer', 'Jan van Eyck', 'Hieronymus Bosch', 'Pieter Bruegel the Elder', 'Giorgione', 'Andrea Mantegna', 'Piero della Francesca', 'Fra Angelico', 'Giovanni Bellini', 'Hans Holbein the Younger', 'Lucas Cranach the Elder', 'Pietro Perugino', 'Domenico Ghirlandaio', 'Correggio'],
    'mannerism': ['Parmigianino', 'Jacopo Pontormo', 'Agnolo Bronzino', 'Rosso Fiorentino', 'El Greco', 'Giulio Romano', 'Giorgio Vasari', 'Domenico Beccafumi'],
    'neoclassicism': ['Jacques-Louis David', 'Jean-Auguste-Dominique Ingres', 'Antonio Canova', 'Angelica Kauffman', 'Anton Raphael Mengs', 'Bertel Thorvaldsen', 'Pompeo Batoni', 'Benjamin West'],
    'symbolism': ['Gustave Moreau', 'Odilon Redon', 'Arnold Böcklin', 'Pierre Puvis de Chavannes', 'Fernand Khnopff', 'Jan Toorop', 'Carlos Schwabe', 'Gustav Klimt'],
    'art nouveau': ['Alphonse Mucha', 'Gustav Klimt', 'Aubrey Beardsley', 'Louis Comfort Tiffany', 'Émile Gallé', 'René Lalique', 'Hector Guimard', 'Koloman Moser', 'Eugène Grasset', 'Théophile Steinlen'],
    'ukiyo-e': ['Katsushika Hokusai', 'Utagawa Hiroshige', 'Kitagawa Utamaro', 'Utagawa Kuniyoshi', 'Suzuki Harunobu', 'Utagawa Kunisada', 'Tōshūsai Sharaku', 'Torii Kiyonaga', 'Keisai Eisen', 'Tsukioka Yoshitoshi', 'Utagawa Toyokuni', 'Hishikawa Moronobu'],
    'pre-raphaelite brotherhood': ['Dante Gabriel Rossetti', 'John Everett Millais', 'William Holman Hunt', 'Edward Burne-Jones', 'John William Waterhouse', 'Ford Madox Brown', 'Arthur Hughes', 'William Morris'],
    'danish golden age': ['Christoffer Wilhelm Eckersberg', 'Christen Købke', 'Wilhelm Bendz', 'Constantin Hansen', 'Martinus Rørbye', 'Jørgen Roed', 'Johan Thomas Lundbye', 'P.C. Skovgaard', 'Wilhelm Marstrand', 'Dankvart Dreyer'],
    'dutch golden age painting': ['Rembrandt', 'Johannes Vermeer', 'Frans Hals', 'Jan Steen', 'Pieter de Hooch', 'Jacob van Ruisdael', 'Aelbert Cuyp', 'Gerard ter Borch', 'Willem Claesz. Heda', 'Rachel Ruysch', 'Judith Leyster', 'Meindert Hobbema', 'Carel Fabritius'],
    'hudson river school': ['Thomas Cole', 'Frederic Edwin Church', 'Albert Bierstadt', 'Asher Brown Durand', 'Sanford Robinson Gifford', 'John Frederick Kensett', 'Jasper Francis Cropsey', 'Thomas Moran'],
    'barbizon school': ['Théodore Rousseau', 'Jean-François Millet', 'Charles-François Daubigny', 'Jean-Baptiste-Camille Corot', 'Narcisse Virgilio Díaz', 'Constant Troyon', 'Jules Dupré'],
    'academic art': ['William-Adolphe Bouguereau', 'Alexandre Cabanel', 'Jean-Léon Gérôme', 'Lawrence Alma-Tadema', 'Frederic Leighton', 'Pedro Américo', 'Victor Meirelles', 'Almeida Júnior'],
    'gothic art': ['Giotto', 'Duccio', 'Simone Martini', 'Cimabue', 'Ambrogio Lorenzetti', 'Pietro Lorenzetti', 'Gentile da Fabriano', 'Limbourg brothers'],
  };

  /* ---------- lookup ---------- */

  const index = new Map();   // folded phrase -> entry
  for (const t of TERMS) {
    const keys = [t.en].concat(t.alt || [], t.pt || [], t.da || []);
    for (const k of keys) {
      const n = U.norm(k);
      if (n && !index.has(n)) index.set(n, t);
    }
  }

  function lookup(phrase) {
    const n = U.norm(phrase);
    if (!n) return null;
    if (index.has(n)) return index.get(n);
    // plural-tolerant single-word lookup: "horses" -> horse, "gatas" -> cat
    const toks = n.split(' ');
    for (const [k, entry] of index) {
      const kt = k.split(' ');
      if (kt.length === toks.length && kt.every((w, i) => U.tokEq(w, toks[i]))) return entry;
    }
    return null;
  }

  function movementArtists(label) {
    const n = U.norm(label);
    for (const k of Object.keys(MOVEMENT_ARTISTS)) {
      if (U.norm(k) === n) return MOVEMENT_ARTISTS[k];
    }
    const entry = lookup(label);
    return entry && entry.kind === 'movement' ? (MOVEMENT_ARTISTS[entry.en] || []) : [];
  }

  function mediumOf(word) {
    const w = U.norm(word);
    const m = MEDIUM.find(x => x.words.includes(w));
    return m ? m.key : null;
  }

  EB.lexicon = { GENERIC, MEDIUM, TERMS, MOVEMENT_ARTISTS, lookup, movementArtists, mediumOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
