"""Meat, fish, eggs and dairy.

Flags: V vegan, T vegetarian, G gluten-free, L lactose-free.
"""

BLOCKS = [
    ("Meat", "Poultry", "GL", "kg", """
Chicken breast;🍗;0.65;165;31;0;3.6
Chicken thighs;🍗;1;209;26;0;11
Chicken drumsticks;🍗;1;172;28;0;5.7
Chicken wings;🍗;0.8;203;30;0;8.1
Whole chicken;🍗;1;239;27;0;14;;unit
Chicken mince;🍗;0.5;143;17;0;8
Turkey breast;🍗;0.5;135;30;0;1
Turkey mince;🍗;0.5;148;20;0;7
Duck breast;🦆;0.4;201;19;0;14
"""),
    ("Meat", "Beef", "GL", "kg", """
Minced beef;🥩;0.5;250;26;0;15;;;ground beef
Beef steak;🥩;0.25;207;27;0;10;;;sirloin steak
Ribeye steak;🥩;0.3;291;24;0;21
Beef stewing meat;🥩;0.5;192;27;0;8.5;;;diced beef
Roast beef;🥩;1;200;28;0;9
Beef burgers;🍔;1;254;17;1;20;L;pack;hamburgers
"""),
    ("Meat", "Pork", "GL", "kg", """
Pork chops;🥩;0.5;231;25;0;14
Pork tenderloin;🥩;0.5;143;26;0;3.5
Pork mince;🥩;0.5;263;17;0;21
Pork belly;🥓;0.5;518;9;0;53
Pork ribs;🍖;1;277;22;0;21
"""),
    ("Meat", "Lamb & game", "GL", "kg", """
Lamb chops;🍖;0.5;294;25;0;21
Lamb mince;🍖;0.5;283;17;0;23
Leg of lamb;🍖;1;258;25;0;17
Rabbit;🐇;1;173;33;0;3.5
"""),
    ("Meat", "Cured & deli", "GL", "pack", """
Sliced ham;🍖;1;107;18;1;3;;;cooked ham
Turkey slices;🍖;1;104;17;4;2
Bacon;🥓;1;541;37;1.4;42
Prosciutto;🍖;1;250;27;0;15;;;parma ham,presunto
Chorizo;🌭;1;455;24;1.9;38;;unit
Salami;🍖;1;336;21;1.2;27
Pancetta;🥓;1;393;14;0;37
Mortadella;🍖;1;311;16;1;27
"""),
    ("Meat", "Sausages", "L", "pack", """
Pork sausages;🌭;1;301;12;3;27
Chicken sausages;🌭;1;215;15;3;16
Frankfurters;🌭;1;290;11;3;26;;;hot dogs
"""),

    ("Fish", "White fish", "GL", "kg", """
Hake fillets;🐟;0.6;90;18;0;1.5;;;pescada
Cod fillets;🐟;0.5;82;18;0;0.7;;;bacalhau fresh
Sea bass;🐟;0.4;97;18;0;2
Sea bream;🐟;0.4;96;19;0;2.2;;;dourada
Haddock;🐟;0.4;74;16;0;0.6
Sole;🐟;0.4;86;18;0;1.2
"""),
    ("Fish", "Oily fish", "GL", "kg", """
Salmon fillets;🐟;0.5;208;20;0;13
Mackerel;🐟;0.4;205;19;0;14
Fresh sardines;🐟;0.5;208;25;0;11;;;sardinhas
Trout;🐟;0.4;141;20;0;6.2
Tuna steak;🐟;0.3;144;23;0;4.9
"""),
    ("Fish", "Shellfish & seafood", "GL", "kg", """
Prawns;🦐;0.4;99;24;0.2;0.3;;;shrimp
Mussels;🦪;1;86;12;3.7;2.2
Clams;🦪;0.5;74;13;2.6;1
Squid;🦑;0.4;92;16;3;1.4
Octopus;🐙;0.5;82;15;2.2;1
Crab;🦀;1;97;19;0;1.5;;pack
Scallops;🦪;1;88;17;2.4;0.8;;pack
"""),
    ("Fish", "Canned fish", "GL", "can", """
Canned tuna;🥫;4;116;26;0;1
Sardines (canned);🥫;2;208;25;0;11;;;canned sardines
Canned mackerel;🥫;2;205;19;0;14
Anchovies;🥫;1;210;29;0;10;;jar
Canned salmon;🥫;1;142;20;0;6.3
"""),
    ("Fish", "Smoked & cured", "GL", "pack", """
Smoked salmon;🐟;1;117;18;0;4.3
Smoked mackerel;🐟;1;305;19;0;25
Salted cod;🐟;1;290;63;0;2.4;;kg;bacalhau
"""),

    ("Eggs", "Eggs", "TGL", "unit", """
Eggs;🥚;12;143;12.6;0.7;9.5;;;hen eggs
Free-range eggs;🥚;12;143;12.6;0.7;9.5
Quail eggs;🥚;12;158;13;0.4;11
Liquid egg whites;🥚;1;52;11;0.7;0.2
"""),

    ("Dairy", "Milk & cream", "TG", "L", """
Milk;🥛;1;46;3.4;4.8;1.6
Whole milk;🥛;1;61;3.2;4.8;3.3
Skimmed milk;🥛;1;34;3.4;5;0.1
Lactose-free milk;🥛;1;46;3.4;4.8;1.6;TGL
Chocolate milk;🥛;1;83;3.2;10.6;3.2
Cream;🥛;1;340;2.1;2.8;36;;unit;whipping cream
Sour cream;🥛;1;193;2.1;2.9;19;;unit
Condensed milk;🥛;1;321;7.9;54;8.7;;can
Evaporated milk;🥛;1;134;6.8;10;7.6;;can
"""),
    ("Dairy", "Yogurt & fresh", "TG", "unit", """
Natural yogurt;🥛;3;61;3.5;4.7;3.3;;;plain yogurt
Greek yogurt;🥛;4;97;9;4;5
Skyr;🥛;2;63;11;4;0.2
Fruit yogurt;🥛;4;90;3.5;15;1.5
Kefir;🥛;1;61;3.4;4.7;3.3;;L
Quark;🥛;1;78;12;4;0.3
"""),
    ("Dairy", "Cheese", "TG", "pack", """
Mozzarella;🧀;1;254;18;2.2;19
Parmesan;🧀;1;431;38;4.1;29;G;;parmigiano,grana padano
Sliced cheese;🧀;1;356;25;1.3;28
Cheddar;🧀;1;403;25;1.3;33
Gouda;🧀;1;356;25;2.2;27
Edam;🧀;1;357;25;1.4;28
Emmental;🧀;1;380;29;1.4;29;;;swiss cheese
Brie;🧀;1;334;21;0.5;28;;unit
Camembert;🧀;1;300;20;0.5;24;;unit
Feta;🧀;1;264;14;4;21
Goat cheese;🧀;1;364;22;2.5;30
Blue cheese;🧀;1;353;21;2.3;29;;;gorgonzola
Halloumi;🧀;1;321;22;2.2;25
Ricotta;🧀;1;174;11;3;13;;unit
Mascarpone;🧀;1;429;4.8;4;44;;unit
Cream cheese;🧀;1;342;6;4;34;;;philadelphia
Cottage cheese;🧀;1;98;11;3.4;4.3;;unit
Fresh cheese;🧀;1;98;12;3;4;;unit;queijo fresco
Grated cheese;🧀;1;400;26;1.5;32
"""),
    ("Dairy", "Butter & spreads", "TG", "pack", """
Butter;🧈;1;717;0.9;0.1;81
Margarine;🧈;1;720;0.2;0.7;80;VGL
Ghee;🧈;1;900;0;0;100;TGL;jar;clarified butter
"""),
    ("Dairy", "Plant-based", "VGL", "L", """
Oat milk;🥛;1;45;1;6.5;1.5;VL;;oat drink
Soy milk;🥛;1;33;3;1.3;1.8;;;soya drink
Almond milk;🥛;1;15;0.5;0.3;1.2;;;almond drink
Rice milk;🥛;1;47;0.3;9.4;1;VL
Soy yogurt;🥛;3;48;4;2.5;2.3;;unit;plant-based yogurt
"""),
]
