"""Vegetables, fruit and fresh herbs.

Row format (see catalog_data/__init__.py):  name;emoji;qty;kcal;protein;carbs;fat;flags;unit;synonyms
Nutrition is per 100 g (or 100 ml) and approximate. Empty fields fall back to the block defaults.
"""

BLOCKS = [
    ("Vegetables", "Leafy greens", "VGL", "unit", """
Lettuce;🥬;1;15;1.4;2.9;0.2
Iceberg lettuce;🥬;1;14;0.9;3;0.1
Mixed salad leaves;🥗;1;20;1.8;3;0.3;;bag;salad mix
Spinach;🥬;1;23;2.9;3.6;0.4;;bag
Rocket;🥬;1;25;2.6;3.7;0.7;;bag;arugula
Kale;🥬;1;49;4.3;8.8;0.9;;bag
Cabbage;🥬;1;25;1.3;5.8;0.1
Red cabbage;🥬;1;31;1.4;7.4;0.2
Swiss chard;🥬;1;19;1.8;3.7;0.2;;bunch;chard
Lamb's lettuce;🥬;1;21;2;3.6;0.4;;bag;corn salad
Pak choi;🥬;2;13;1.5;2.2;0.2;;unit;bok choy
Watercress;🥬;1;11;2.3;1.3;0.1;;bag
Endive;🥬;1;17;1.3;3.4;0.2
Radicchio;🥬;1;23;1.4;4.5;0.3
"""),
    ("Vegetables", "Roots & tubers", "VGL", "kg", """
Potatoes;🥔;2;77;2;17;0.1
New potatoes;🥔;1;70;1.9;16;0.1
Sweet potatoes;🍠;1;86;1.6;20;0.1
Carrots;🥕;0.8;41;0.9;10;0.2
Beetroot;🥕;0.5;43;1.6;10;0.2;;;beet
Parsnips;🥕;0.5;75;1.2;18;0.3
Turnips;🥕;0.5;28;0.9;6.4;0.1
Radishes;🥕;1;16;0.7;3.4;0.1;;bunch
Celeriac;🥕;1;42;1.5;9.2;0.3;;unit
Swede;🥕;1;38;1.1;8.6;0.2;;unit;rutabaga
Ginger;🌱;0.1;80;1.8;18;0.8;;;ginger root
Cassava;🥔;0.5;160;1.4;38;0.3;;;yuca,manioc
"""),
    ("Vegetables", "Onions & garlic", "VGL", "kg", """
Onions;🧅;1.5;40;1.1;9;0.1
Red onions;🧅;0.5;40;1.1;9.3;0.1
Shallots;🧅;0.25;72;2.5;17;0.1
Spring onions;🧅;1;32;1.8;7.3;0.2;;bunch;scallions
Leeks;🧅;2;61;1.5;14;0.3;;unit
Garlic;🧄;2;149;6.4;33;0.5;;unit;garlic bulb
"""),
    ("Vegetables", "Brassicas", "VGL", "unit", """
Broccoli;🥦;1;34;2.8;6.6;0.4
Cauliflower;🥦;1;25;1.9;5;0.3
Tenderstem broccoli;🥦;1;34;2.8;6.6;0.4;;pack
Brussels sprouts;🥬;0.5;43;3.4;9;0.3;;kg
Romanesco;🥦;1;25;2;5;0.3
"""),
    ("Vegetables", "Fruiting vegetables", "VGL", "unit", """
Tomatoes;🍅;0.6;18;0.9;3.9;0.2;;kg
Cherry tomatoes;🍅;1;18;0.9;3.9;0.2;;pack
Cucumber;🥒;1;15;0.7;3.6;0.1
Courgette;🥒;0.5;17;1.2;3.1;0.3;;kg;zucchini
Aubergine;🍆;1;25;1;5.9;0.2;;unit;eggplant
Bell peppers;🫑;3;31;1;6;0.3;;unit;capsicum,peppers
Chili peppers;🌶️;3;40;1.9;8.8;0.4;;unit;chilli
Sweetcorn;🌽;2;86;3.3;19;1.4;;unit;corn on the cob
Green beans;🌱;0.4;31;1.8;7;0.1;;kg
Fresh peas;🌱;0.5;81;5.4;14;0.4;;kg;garden peas
Okra;🌱;0.3;33;1.9;7.5;0.2;;kg
Broad beans;🌱;0.5;88;7.9;18;0.7;;kg;fava beans
"""),
    ("Vegetables", "Squash & pumpkin", "VGL", "unit", """
Pumpkin;🎃;1;26;1;6.5;0.1;;kg
Butternut squash;🎃;1;45;1;12;0.1
Acorn squash;🎃;1;40;0.8;10;0.1
"""),
    ("Vegetables", "Stalks & shoots", "VGL", "unit", """
Celery;🥬;1;16;0.7;3;0.2
Asparagus;🌱;1;20;2.2;3.9;0.1;;bunch
Fennel;🌱;1;31;1.2;7.3;0.2
Artichokes;🌱;2;47;3.3;11;0.2
Bean sprouts;🌱;1;30;3;6;0.2;;bag
Rhubarb;🌱;0.5;21;0.9;4.5;0.2;;kg
"""),
    ("Vegetables", "Mushrooms", "VGL", "kg", """
Mushrooms;🍄;0.25;22;3.1;3.3;0.3;;;white mushrooms,button mushrooms
Chestnut mushrooms;🍄;0.25;22;2.5;4.3;0.1;;pack;cremini
Portobello mushrooms;🍄;2;22;2.1;3.9;0.4;;unit
Shiitake mushrooms;🍄;0.2;34;2.2;6.8;0.5;;pack
Oyster mushrooms;🍄;0.2;33;3.3;6.1;0.4;;pack
"""),
    ("Vegetables", "Fresh herbs", "VGL", "bunch", """
Parsley;🌿;1;36;3;6.3;0.8
Coriander;🌿;1;23;2.1;3.7;0.5;;;cilantro
Basil;🌿;1;23;3.2;2.7;0.6
Mint;🌿;1;44;3.3;8.4;0.7
Dill;🌿;1;43;3.5;7;1.1
Chives;🌿;1;30;3.3;4.4;0.7
Rosemary;🌿;1;131;3.3;21;5.9
Thyme;🌿;1;101;5.6;24;1.7
Sage;🌿;1;101;3.4;21;1.7
Lemongrass;🌿;1;99;1.8;25;0.5
"""),

    ("Fruit", "Citrus", "VGL", "unit", """
Lemons;🍋;3;29;1.1;9.3;0.3
Limes;🍋;3;30;0.7;11;0.2
Oranges;🍊;1;47;0.9;12;0.1;;kg
Mandarins;🍊;0.5;53;0.8;13;0.3;;kg;clementines,tangerines
Grapefruit;🍊;2;42;0.8;11;0.1
"""),
    ("Fruit", "Berries & grapes", "VGL", "kg", """
Strawberries;🍓;0.5;32;0.7;7.7;0.3
Blueberries;🫐;0.125;57;0.7;14;0.3
Raspberries;🍓;0.125;52;1.2;12;0.7
Blackberries;🫐;0.125;43;1.4;10;0.5
Grapes;🍇;0.5;69;0.7;18;0.2
Cranberries;🍓;0.2;46;0.4;12;0.1
"""),
    ("Fruit", "Apples & pears", "VGL", "unit", """
Apples;🍎;6;52;0.3;14;0.2
Green apples;🍏;4;52;0.3;14;0.2;;;granny smith
Pears;🍐;1;57;0.4;15;0.1;;kg
Quince;🍐;2;57;0.4;15;0.1
"""),
    ("Fruit", "Stone fruit", "VGL", "kg", """
Peaches;🍑;0.5;39;0.9;10;0.3
Nectarines;🍑;0.5;44;1.1;11;0.3
Plums;🍑;0.5;46;0.7;11;0.3
Apricots;🍑;0.5;48;1.4;11;0.4
Cherries;🍒;0.5;63;1.1;16;0.2
Fresh figs;🍑;0.25;74;0.8;19;0.3
"""),
    ("Fruit", "Tropical", "VGL", "unit", """
Bananas;🍌;3;89;1.1;23;0.3
Avocado;🥑;2;160;2;9;15
Mango;🥭;1;60;0.8;15;0.4
Pineapple;🍍;1;50;0.5;13;0.1
Kiwi;🥝;4;61;1.1;15;0.5
Papaya;🥭;1;43;0.5;11;0.3
Coconut;🥥;1;354;3.3;15;33
Pomegranate;🍎;1;83;1.7;19;1.2
Passion fruit;🍑;4;97;2.2;23;0.7
"""),
    ("Fruit", "Melons", "VGL", "unit", """
Watermelon;🍉;1;30;0.6;7.6;0.2
Melon;🍈;1;34;0.8;8.2;0.2;;;cantaloupe,honeydew
"""),
    ("Fruit", "Dried fruit", "VGL", "pack", """
Raisins;🍇;1;299;3.1;79;0.5;;;sultanas
Dried apricots;🍑;1;241;3.4;63;0.5
Dates;🌴;1;282;2.5;75;0.4
Prunes;🍑;1;240;2.2;64;0.4
Dried figs;🍑;1;249;3.3;64;0.9
Dried cranberries;🍓;1;308;0.1;82;1.4
Dried mango;🥭;1;319;2.4;78;1.2
"""),
]
