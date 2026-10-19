/* Card catalogue. Card ids are permanent: they are stored in albums and backups. */
window.MP = window.MP || {};

(function () {
  const ADVENTURE = [
    'Neon Racer', 'Monster Truck', 'Desert Buggy', 'Forest Racer', 'Sky Car',
    'Fire Engine', 'Mountain Rally Car', 'Moto Rider', 'Rocket Robot', 'Giant Robot Friend',
    'Space Explorer', 'Helper Robot', 'Jet Robot', 'Pirate Captain', 'Treasure Hunter',
    'Ship Captain', 'Blue Hero', 'Shield Hero', 'Flying Hero', 'Star Knight'
  ];
  const WONDER = [
    'Flower Fairy', 'Unicorn', 'Mermaid and Turtle', 'Princess', 'Kitten and Puppy',
    'Astronaut', 'Baby Dragon', 'Nature Explorer', 'Ballerina', 'Animal Doctor',
    'Painter', 'Violinist', 'Pilot', 'Robot Builder', 'Cake Baker',
    'Super Hero', 'Pirate Treasure', 'Little Deer', 'Gardener', 'Pony Rider'
  ];

  const COLLECTIONS = [
    { id: 'adventure', name: 'Adventure', prefix: 'adv', names: ADVENTURE },
    { id: 'wonder', name: 'Wonder', prefix: 'won', names: WONDER }
  ];

  const CARDS = [];
  COLLECTIONS.forEach(function (col) {
    col.names.forEach(function (name, i) {
      const id = col.prefix + '-' + String(i + 1).padStart(2, '0');
      CARDS.push({ id: id, collection: col.id, index: i, number: i + 1, name: name, src: 'assets/cards/' + id + '.jpg' });
    });
  });

  const BY_ID = {};
  CARDS.forEach(function (c) { BY_ID[c.id] = c; });

  MP.COLLECTIONS = COLLECTIONS.map(function (c) { return { id: c.id, name: c.name, size: c.names.length }; });
  MP.CARDS = CARDS;
  MP.CARD_BY_ID = BY_ID;
  MP.CARD_BACK = 'assets/card-back.jpg';
  MP.cardsIn = function (collectionId) { return CARDS.filter(function (c) { return c.collection === collectionId; }); };
  MP.collectionName = function (id) { const c = COLLECTIONS.find(function (x) { return x.id === id; }); return c ? c.name : id; };
})();
