"""Carbohydrates, pantry, and frozen food.

Flags: V vegan, T vegetarian, G gluten-free, L lactose-free.
Cooked-staple rows (pasta, rice, grains) list nutrition as cooked; flours, oats and cereals as dry.
"""

BLOCKS = [
    ("Carbohydrates", "Bread", "VL", "unit", """
Bread;🍞;1;265;9;49;3.2
Wholemeal bread;🍞;1;247;13;41;3.4
Sourdough bread;🍞;1;250;8.5;50;1
Bread rolls;🥖;6;280;9;53;3
Baguette;🥖;1;270;9;55;1.5
Pitta bread;🫓;1;275;9;56;1.2;;pack
Tortilla wraps;🫓;1;305;8;52;7;;pack
Naan bread;🫓;1;310;9;50;8;T;pack
Burger buns;🍔;1;279;9;50;4;T;pack
Brioche;🥐;1;350;8;50;13;T
Croissants;🥐;1;406;8;46;21;T;pack
Gluten-free bread;🍞;1;250;3;48;4;VGL
"""),
    ("Carbohydrates", "Pasta & noodles", "VL", "kg", """
Spaghetti;🍝;1;158;5.8;31;0.9
Penne;🍝;0.5;158;5.8;31;0.9
Fusilli;🍝;0.5;158;5.8;31;0.9
Macaroni;🍝;0.5;158;5.8;31;0.9
Tagliatelle;🍝;0.5;131;5;25;1.1;T
Lasagne sheets;🍝;1;131;5;25;1.1;;pack
Wholemeal pasta;🍝;0.5;124;5.3;25;0.5
Gluten-free pasta;🍝;0.5;160;3.5;35;0.9;VGL
Egg noodles;🍜;1;138;4.5;25;2.1;T;pack
Rice noodles;🍜;1;109;0.9;25;0.2;VGL;pack
Udon noodles;🍜;1;127;3.4;27;0.3;;pack
Instant noodles;🍜;1;450;9;62;18;;pack
Gnocchi;🥔;1;130;3;27;0.5;;pack
"""),
    ("Carbohydrates", "Rice & grains", "VGL", "kg", """
White rice;🍚;1.5;130;2.7;28;0.3
Brown rice;🍚;1;123;2.7;26;1
Basmati rice;🍚;1;121;3.5;25;0.4
Risotto rice;🍚;1;130;2.7;28;0.3;;;arborio
Sushi rice;🍚;1;130;2.7;28;0.3
Quinoa;🌾;0.5;120;4.4;21;1.9
Couscous;🌾;0.5;112;3.8;23;0.2;VL
Bulgur;🌾;0.5;83;3;18.6;0.2;VL
Pearl barley;🌾;0.5;123;2.3;28;0.4;VL
Polenta;🌽;0.5;70;1.5;15;0.3
Oats;🌾;0.5;389;17;66;7;VL;;porridge oats,rolled oats
"""),
    ("Carbohydrates", "Flour", "VL", "kg", """
Plain flour;🌾;1;364;10;76;1;;;all-purpose flour
Self-raising flour;🌾;1;349;9;74;1.3
Wholemeal flour;🌾;1;340;13;72;2.5
Rye flour;🌾;1;325;9;76;1.7
Gluten-free flour;🌾;1;350;6;78;1.5;VGL
"""),
    ("Carbohydrates", "Cereal", "VL", "box", """
Cereal;🥣;1;370;8;75;3
Corn flakes;🥣;1;357;7.5;84;0.4
Muesli;🥣;1;360;9;66;6
Granola;🥣;1;450;9;64;17
Chocolate cereal;🥣;1;380;7;78;4
"""),

    ("Pantry", "Oils & vinegars", "VGL", "bottle", """
Olive oil;🫒;1;884;0;0;100;;L
Extra virgin olive oil;🫒;1;884;0;0;100;;L
Sunflower oil;🌻;1;884;0;0;100;;L
Vegetable oil;🫒;1;884;0;0;100;;L
Sesame oil;🫒;1;884;0;0;100
Coconut oil;🥥;1;862;0;0;100;;jar
Vinegar;🍶;1;18;0;0;0;;;white vinegar
Balsamic vinegar;🍶;1;88;0.5;17;0
Apple cider vinegar;🍶;1;21;0;0.9;0
Red wine vinegar;🍶;1;19;0;0.3;0
Cooking spray;🫒;1;700;0;0;78
"""),
    ("Pantry", "Spices & herbs", "VGL", "jar", """
Salt;🧂;1;0;0;0;0;;pack
Sea salt;🧂;1;0;0;0;0;;pack
Black pepper;🧂;1;251;10;64;3.3;;;pepper
Paprika;🌶️;1;282;14;54;13
Smoked paprika;🌶️;1;282;14;54;13;;;pimentón
Cumin;🌿;1;375;18;44;22
Dried oregano;🌿;1;265;9;69;4.3;;;oregano
Dried thyme;🌿;1;276;9.1;64;7.4
Mixed herbs;🌿;1;265;9;69;4.3
Cinnamon;🌿;1;247;4;81;1.2
Chili flakes;🌶️;1;282;12;50;14;;;crushed chilli
Bay leaves;🌿;1;313;7.6;75;8.4
Turmeric;🌿;1;354;8;65;10
Curry powder;🌿;1;325;14;58;14
Garlic powder;🧄;1;331;17;73;0.7
Ground ginger;🌿;1;335;9;72;4.2
Nutmeg;🌿;1;525;5.8;49;36
Cloves;🌿;1;274;6;66;13
Coriander seeds;🌿;1;298;12;55;18
Chicken seasoning;🌿;1;250;8;40;6
Peppercorns;🧂;1;251;10;64;3.3
Vanilla extract;🌿;1;288;0.1;12.7;0.1;;bottle
"""),
    ("Pantry", "Sauces & condiments", "VGL", "jar", """
Mayonnaise;🥫;1;680;1;0.6;75;TGL
Dijon mustard;🥫;1;66;4.4;5.8;4;;;mustard
Ketchup;🍅;1;112;1.7;26;0.1;;bottle
Soy sauce;🥫;1;53;8;4.9;0.6;VL;bottle
Hot sauce;🌶️;1;11;0.5;1.8;0.1;;bottle;tabasco
Sriracha;🌶️;1;93;1.9;19;1;;bottle
BBQ sauce;🥫;1;172;1;40;0.6;;bottle
Teriyaki sauce;🥫;1;89;5.9;15;0;VL;bottle
Worcestershire sauce;🥫;1;78;0;19;0;GL;bottle
Fish sauce;🥫;1;35;5;3.6;0;GL;bottle
Oyster sauce;🥫;1;51;1.4;11;0.3;L;bottle
Pesto;🥫;1;458;5;5;47;TG
Passata;🍅;1;32;1.5;5;0.2;;bottle;tomato sauce
Pasta sauce;🍅;1;50;1.7;8;1.4
Curry paste;🥫;1;135;3;12;8
Harissa;🌶️;1;100;3;10;5
Hummus;🧆;1;166;8;14;10
Tahini;🥫;1;595;17;21;54
Salad dressing;🥫;1;300;0.5;12;28;;bottle;vinaigrette
Pickled gherkins;🥒;1;14;0.5;2;0.2;;;pickles
Capers;🥫;1;23;2.4;4.9;0.9
Olives;🫒;1;115;0.8;6;11;;;green olives,black olives
Sun-dried tomatoes;🍅;1;258;14;56;3
Kimchi;🥬;1;15;1.1;2.4;0.5;GL
Miso paste;🥫;1;199;12;26;6;VL
"""),
    ("Pantry", "Canned goods", "VGL", "can", """
Chopped tomatoes;🥫;4;24;1.3;4.4;0.2
Peeled tomatoes;🥫;2;24;1.3;4.4;0.2
Tomato paste;🥫;1;82;4.3;19;0.5;;;tomato puree
Chickpeas;🥫;2;139;7;23;2.1;;;garbanzo beans
Kidney beans;🥫;2;127;8.7;22.8;0.5
Black beans;🥫;2;132;8.9;24;0.5
White beans;🥫;2;114;7.5;20;0.5;;;cannellini beans
Canned lentils;🥫;2;116;9;20;0.4
Baked beans;🥫;2;90;5;15;0.5
Canned sweetcorn;🌽;2;86;3.3;19;1.4
Canned peas;🥫;2;69;4.5;12;0.4
Coconut milk;🥥;2;197;2;2.8;21
Canned pineapple;🍍;1;60;0.4;16;0.1
Canned peaches;🍑;1;54;0.5;14;0.1
Canned soup;🍲;2;40;1.5;6;1;VL
"""),
    ("Pantry", "Dried legumes", "VGL", "kg", """
Lentils;🌱;0.5;352;25;60;1.1
Red lentils;🌱;0.5;352;25;60;1.1
Dried chickpeas;🌱;0.5;364;19;61;6
Dried kidney beans;🌱;0.5;333;24;60;0.8
Dried white beans;🌱;0.5;333;23;60;0.9;;;feijão branco
Split peas;🌱;0.5;341;24;60;1.2
"""),
    ("Pantry", "Baking", "VGL", "pack", """
Cornflour;🌽;1;381;0.3;91;0.1;;box;cornstarch
Baking powder;🥄;1;53;0;28;0
Baking soda;🥄;1;0;0;0;0;;;bicarbonate of soda
Dried yeast;🥄;1;325;40;41;7.6
Sugar;🍬;1;387;0;100;0;;kg
Brown sugar;🍬;1;380;0;98;0;;kg
Icing sugar;🍬;1;389;0;99.8;0;;kg
Cocoa powder;🍫;1;228;20;58;14
Chocolate chips;🍫;1;480;5;60;24;TG
Breadcrumbs;🍞;1;395;13;72;5;VL
Desiccated coconut;🥥;1;660;6.9;24;65
Gelatine;🥄;1;335;86;0;0;GL
"""),
    ("Pantry", "Spreads & sweeteners", "VGL", "jar", """
Honey;🍯;1;304;0.3;82;0;TGL
Peanut butter;🥜;1;588;25;20;50
Almond butter;🥜;1;614;21;19;56
Jam;🍓;1;250;0.4;62;0.1;;;strawberry jam
Marmalade;🍊;1;250;0.3;62;0.1
Hazelnut spread;🍫;1;539;6;58;31;TG;;nutella
Maple syrup;🍁;1;260;0;67;0;;bottle
Agave syrup;🍯;1;310;0;76;0;;bottle
Sweetener;🍬;1;0;0;0;0;;box;stevia
"""),
    ("Pantry", "Stocks & soups", "VL", "box", """
Vegetable stock cubes;🧂;1;237;7;23;13
Chicken stock cubes;🧂;1;237;7;23;13;L
Beef stock cubes;🧂;1;237;7;23;13;L
Instant soup;🍲;1;350;8;60;7;;pack
Bouillon powder;🧂;1;237;7;23;13;;jar
"""),
    ("Pantry", "Plant protein & world foods", "VGL", "pack", """
Tofu;🌱;1;76;8;1.9;4.8
Tempeh;🌱;1;192;20;7.6;11
Seitan;🌱;1;120;25;4;1.9;VL
Nori sheets;🍙;1;35;5.8;5.1;0.3
Rice paper;🥬;1;333;0.6;82;0.1
Taco shells;🌮;1;466;6;60;22;VL;box
Wasabi;🌱;1;109;4.8;24;0.6;;jar
Textured soy protein;🌱;1;330;52;30;1;VL
"""),

    ("Frozen", "Frozen vegetables", "VGL", "bag", """
Frozen peas;🌱;1;77;5.4;14;0.4
Frozen mixed vegetables;🥕;1;65;3;12;0.5
Frozen spinach;🥬;1;23;2.9;3.6;0.4
Frozen broccoli;🥦;1;35;2.8;7;0.4
Frozen green beans;🌱;1;31;1.8;7;0.1
Frozen sweetcorn;🌽;1;86;3.3;19;1.4
Frozen cauliflower;🥦;1;25;1.9;5;0.3
Frozen stir-fry mix;🥕;1;40;2.5;7;0.3
Frozen chips;🍟;1;140;2.7;22;5;VL
Frozen roast potatoes;🥔;1;130;2.5;21;4;VL
"""),
    ("Frozen", "Frozen fruit", "VGL", "bag", """
Frozen berries;🫐;1;45;0.9;10;0.3;;;mixed berries
Frozen strawberries;🍓;1;32;0.7;7.7;0.3
Frozen raspberries;🍓;1;52;1.2;12;0.7
Frozen mango;🥭;1;60;0.8;15;0.4
Frozen blueberries;🫐;1;57;0.7;14;0.3
"""),
    ("Frozen", "Frozen meals", "VL", "pack", """
Frozen pizza;🍕;2;266;11;33;10;T;unit
Frozen lasagne;🍝;1;150;7;15;7;;pack
Chicken nuggets;🍗;1;250;14;15;15;L
Frozen meatballs;🍖;1;200;14;8;12;L
Frozen dumplings;🥟;1;190;7;28;5;L
Spring rolls;🥟;1;230;5;30;10;L
Veggie burgers;🍔;1;190;11;16;9;VL
Frozen vegetable curry;🍛;1;110;3;14;5;VGL
"""),
    ("Frozen", "Frozen fish", "L", "pack", """
Frozen fish fingers;🍤;1;190;12;18;8
Frozen prawns;🦐;1;99;24;0.2;0.3;GL;bag
Frozen salmon portions;🐟;1;208;20;0;13;GL
Frozen cod portions;🐟;1;82;18;0;0.7;GL
Frozen calamari rings;🦑;1;175;8;15;9;;bag
"""),
    ("Frozen", "Frozen desserts", "TG", "unit", """
Ice cream;🍨;1;207;3.5;24;11
Sorbet;🍧;1;130;0.4;32;0;VGL
Ice lollies;🍦;1;90;0;22;0;VGL;pack
Frozen yogurt;🍦;1;159;4;24;5
"""),
    ("Frozen", "Frozen bakery", "VL", "pack", """
Puff pastry;🥐;1;558;7;45;38;;pack;frozen pastry
Shortcrust pastry;🥐;1;450;6;45;28
Frozen pizza dough;🍕;1;250;8;48;2
Frozen garlic bread;🥖;1;350;7;42;17
"""),
]
