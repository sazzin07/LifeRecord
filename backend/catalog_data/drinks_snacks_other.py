"""Drinks, snacks, and household items.

Flags: V vegan, T vegetarian, G gluten-free, L lactose-free. Household rows have no nutrition.
"""

BLOCKS = [
    ("Drinks", "Water", "VGL", "bottle", """
Still water;💧;6;0;0;0;0;;;mineral water
Sparkling water;💧;6;0;0;0;0
Flavoured water;💧;6;2;0;0.5;0
Coconut water;🥥;1;19;0.7;3.7;0.2
Tonic water;🥤;4;34;0;8.8;0
"""),
    ("Drinks", "Soft drinks", "VGL", "bottle", """
Cola;🥤;1;42;0;10.6;0;;;coke
Diet cola;🥤;1;0;0;0;0;;;zero cola
Lemonade;🥤;1;40;0;10;0
Orange soda;🥤;1;45;0;11;0;;;fanta
Iced tea;🥤;1;30;0;7.5;0
Energy drink;⚡;4;45;0;11;0;;can
Ginger ale;🥤;1;34;0;8.7;0
Sports drink;🥤;1;26;0;6.4;0
"""),
    ("Drinks", "Juices", "VGL", "L", """
Orange juice;🧃;1;45;0.7;10.4;0.2
Apple juice;🧃;1;46;0.1;11.4;0.1
Pineapple juice;🧃;1;53;0.4;13;0.1
Cranberry juice;🧃;1;46;0.4;12;0.1
Tomato juice;🧃;1;17;0.8;3.5;0.1
Multivitamin juice;🧃;1;48;0.5;11;0.1
Smoothie;🧃;1;55;1;12;0.4;;bottle
"""),
    ("Drinks", "Coffee & tea", "VGL", "pack", """
Ground coffee;☕;1;;;;;;;coffee
Coffee beans;☕;1
Instant coffee;☕;1;;;;;;jar
Coffee capsules;☕;1;;;;;;box
Decaf coffee;☕;1
Tea bags;🍵;1;;;;;;box;black tea
Green tea;🍵;1;;;;;;box
Peppermint tea;🍵;1;;;;;;box
Chamomile tea;🍵;1;;;;;;box;camomile
Rooibos tea;🍵;1;;;;;;box
Matcha;🍵;1;;;;;;jar
Hot chocolate powder;🍫;1;390;6;70;9;T;box;cocoa drink
"""),
    ("Drinks", "Wine", "VGL", "bottle", """
Red wine;🍷;1;85;0.1;2.6;0;;;vinho tinto
White wine;🥂;1;82;0.1;2.6;0;;;vinho branco
Rosé wine;🍷;1;83;0.1;2.5;0
Vinho verde;🥂;1;75;0.1;2;0
Sparkling wine;🍾;1;80;0.2;1.5;0;;;prosecco,cava,champagne
Port wine;🍷;1;160;0.1;12;0;;;vinho do porto
"""),
    ("Drinks", "Beer & cider", "VL", "bottle", """
Beer;🍺;6;43;0.5;3.6;0;;;lager
Craft beer;🍺;4;50;0.6;4;0
Non-alcoholic beer;🍺;6;20;0.3;4;0
Cider;🍏;4;45;0;5;0;VGL
"""),
    ("Drinks", "Spirits", "VGL", "bottle", """
Vodka;🍸;1;231;0;0;0
Gin;🍸;1;263;0;0;0
Rum;🥃;1;231;0;0;0
Whisky;🥃;1;250;0;0;0;;;whiskey
Tequila;🥃;1;231;0;0;0
Brandy;🥃;1;231;0;0;0
Liqueur;🥃;1;300;0;30;0
"""),

    ("Snacks", "Chocolate & sweets", "TG", "unit", """
Dark chocolate;🍫;2;546;5;61;31;VGL
Milk chocolate;🍫;2;535;7.7;59;30
White chocolate;🍫;1;539;5.9;59;32
Gummy bears;🍬;1;343;7;77;0.5;GL;bag;gummies
Marshmallows;🍬;1;318;1.8;81;0.2;GL;bag
Hard candy;🍬;1;394;0;98;0.2;VGL;bag;boiled sweets
Liquorice;🍬;1;375;4;85;0.5;VL;bag
Mints;🍬;1;390;0;97;0.5;VGL;box
Chocolate truffles;🍫;1;550;6;50;36;;box
"""),
    ("Snacks", "Biscuits & cakes", "T", "pack", """
Biscuits;🍪;1;450;6;70;17
Digestive biscuits;🍪;1;480;7;65;20
Chocolate biscuits;🍪;1;500;6;65;24
Cookies;🍪;1;480;5;64;23
Oat biscuits;🍪;1;450;7;64;18
Cake;🍰;1;390;5;55;17;;unit
Muffins;🧁;1;400;5;52;19
Doughnuts;🍩;1;400;5;48;21
Pastel de nata;🥧;1;298;5;35;15;;unit;custard tart
Rice cakes;🍘;1;387;8;81;3;VGL
Crackers;🍘;1;430;10;71;12;VL
Breadsticks;🥖;1;410;11;72;8;VL
"""),
    ("Snacks", "Crisps & savoury", "VGL", "bag", """
Crisps;🥔;1;536;6;53;34;;;chips
Tortilla chips;🌽;1;489;7;63;24
Popcorn;🍿;1;387;11;74;4.3
Pretzels;🥨;1;380;10;80;3;VL
Cheese puffs;🧀;1;540;7;55;32;TG
Rice crackers;🍘;1;390;7;83;3
"""),
    ("Snacks", "Nuts & seeds", "VGL", "bag", """
Almonds;🌰;1;579;21;22;50
Walnuts;🌰;1;654;15;14;65
Cashews;🥜;1;553;18;30;44
Peanuts;🥜;1;567;26;16;49
Pistachios;🥜;1;560;20;28;45
Hazelnuts;🌰;1;628;15;17;61
Pine nuts;🌰;1;673;14;13;68
Brazil nuts;🌰;1;659;14;12;67
Pecans;🌰;1;691;9;14;72
Mixed nuts;🥜;1;607;20;21;54
Trail mix;🥜;1;462;14;45;29
Sunflower seeds;🌻;1;584;21;20;51
Pumpkin seeds;🎃;1;559;30;11;49
Chia seeds;🌱;1;486;17;42;31
Flaxseed;🌱;1;534;18;29;42;;;linseed
Sesame seeds;🌱;1;573;18;23;50;;jar
"""),
    ("Snacks", "Bars", "TG", "box", """
Protein bars;💪;1;350;30;35;10
Cereal bars;🍫;1;390;6;70;9;T
Granola bars;🍫;1;420;7;66;14;VL
Fruit bars;🍓;1;350;2;75;4;VGL
"""),

    ("Other", "Cleaning", "", "bottle", """
Washing-up liquid;🧴;1
All-purpose cleaner;🧴;1
Bleach;🧴;1
Glass cleaner;🧴;1
Floor cleaner;🧴;1
Dishwasher tablets;🧽;1;;;;;;box
Sponges;🧽;1;;;;;;pack
Bin bags;🗑️;1;;;;;;pack;trash bags
Rubber gloves;🧤;1;;;;;;pack
"""),
    ("Other", "Laundry", "", "bottle", """
Laundry detergent;🧺;1
Fabric softener;🧺;1
Stain remover;🧺;1
Laundry pods;🧺;1;;;;;;box
"""),
    ("Other", "Paper & wrap", "", "pack", """
Toilet paper;🧻;1
Kitchen roll;🧻;1;;;;;;;paper towels
Tissues;🧻;1;;;;;;box
Napkins;🧻;1
Aluminium foil;🧻;1;;;;;;;tin foil
Baking paper;🧻;1;;;;;;;parchment paper
Cling film;🧻;1;;;;;;;plastic wrap
Sandwich bags;🧻;1
Freezer bags;🧻;1;;;;;;box
"""),
    ("Other", "Personal care", "", "bottle", """
Shampoo;🧴;1
Conditioner;🧴;1
Shower gel;🧴;1
Hand soap;🧼;1
Soap bars;🧼;1;;;;;;pack
Toothpaste;🪥;1;;;;;;unit
Toothbrush;🪥;1;;;;;;pack
Deodorant;🧴;1;;;;;;unit
Razors;🪒;1;;;;;;pack
Cotton pads;🧴;1;;;;;;pack
Sunscreen;🧴;1
"""),
    ("Other", "Pets & baby", "", "pack", """
Dog food;🐕;1;;;;;;bag
Cat food;🐈;1;;;;;;box
Cat litter;🐈;1;;;;;;bag
Nappies;👶;1
Baby wipes;👶;1
"""),
    ("Other", "Home essentials", "", "pack", """
Batteries;🔋;1
Light bulbs;💡;1
Matches;🔥;1;;;;;;box
Candles;🕯️;1
"""),
]
