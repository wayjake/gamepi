'use strict';
// Tomo -- a friend that lives in the machine.
//
// A virtual pet in the Tamagotchi mould, and the one game here that runs on
// the *wall clock*. Everything else in src/games/ is a pure function of its
// inputs and a fixed timestep; Tomo also has to know how long you were gone,
// because a pet that only gets hungry while you are looking at it is a toy,
// not a pet. The rule that keeps it testable: the clock is consulted in exactly
// three places -- hatching, loading and saving -- and is injectable
// (`options.clock`). Between those, time is `dt` like everywhere else, so a
// session replays from its inputs and the tests can run a week in a loop.
//
// The save (`~/.gamepi/tomo.json`) is the pet. It is written every SAVE_EVERY
// seconds of play and at every screen change, because the way out of a game
// here is an OS-level combo the game never sees.
//
// The point of the game is that it does not end. The almanac is the point of
// playing it: FACETS at the bottom of the catalogue below is every named thing
// -- food, illness, visitor, dream, badge, pastime -- and the almanac counts
// how many you have met.

const fs = require('fs');
const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const { sway, hop, pulse } = require('../gfx/motion');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));   // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'tomo';
const SAVE_VERSION = 1;
const SAVE_FILE = path.join(scores.DIR, 'tomo.json');
const SAVE_EVERY = 15;          // seconds of play between saves

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

// --- the clockwork -----------------------------------------------------------
//
// Stats are 0..100 and drain per real hour. A full pet is empty nine hours
// after a meal, which is "feed it when you get home and before bed" -- the
// rhythm the original ran on. Health only moves when something is wrong, and
// slowly: from full it takes thirty hours of starving to lose a pet, so a
// missed day is a scare, not a funeral.
const RATE = {
  food: 100 / 9,
  joy: 100 / 12,
  restAwake: 100 / 18,
  restAsleep: 100 / 8,       // recovered, not lost
  starve: 100 / 30,          // health, while food is 0
  dirty: 100 / 48,           // health, while there are messes about
  sick: 100 / 24,            // health, while ill
  sad: 100 / 72,             // health, while joy is 0
  mend: 100 / 24,            // health back, while nothing is wrong
};
const DIGEST = 4 * HOUR;     // a meal comes out this long after it went in
const MAX_MESS = 3;
const BEDTIME = 22;          // it puts itself to bed
const WAKE_HOUR = 7;
const TIRED = 20;            // below this it will not play
const HUNGRY = 10;           // below this either
const FULL = 92;             // above this it will not eat
const SLEEPY = 60;           // above this it will not be tucked in
const CATCH_UP_STEP = 5 * MINUTE;
const CATCH_UP_MAX = 30 * DAY;
const SICK_AFTER = 5 * HOUR; // awake with a mess on the floor
const VISIT_EVERY = 8 * MINUTE;
const VISIT_CHANCE = 0.3;
const DREAM_EVERY = 3 * MINUTE;
const PAT_COOLDOWN = 20;
const BEANS_START = 60;

// XP to reach the *next* level. Quadratic, gently: level 11 (programming) is a
// few days of ordinary care, level 20 (the cure for science) is a few weeks.
const xpFor = (level) => 12 * level * (level + 1);

// --- who it can be -----------------------------------------------------------

// Seven bodies. `s` is the stage's size factor; everything else about a body
// comes from `look`, rolled once at hatching.
const ARCHETYPES = [
  { id: 'blob', name: 'BLOB', line: 'ROUND. VERY ROUND.' },
  { id: 'sprout', name: 'SPROUT', line: 'SOMETHING IS GROWING ON ITS HEAD.' },
  { id: 'puff', name: 'PUFF', line: 'MOSTLY FLUFF. SOME OPINIONS.' },
  { id: 'box', name: 'BOX', line: 'CORNERS. IT HAS CORNERS.' },
  { id: 'noodle', name: 'NOODLE', line: 'TALL, AND STILL DECIDING WHICH WAY.' },
  { id: 'shell', name: 'SHELL', line: 'CARRIES ITS HOUSE. NEVER LOCKED OUT.' },
  { id: 'wisp', name: 'WISP', line: 'NOT QUITE ALL THERE. CHARMINGLY.' },
];

const TEMPERS = [
  { id: 'calm', name: 'CALM', hunger: 1, joy: 0.85, bonus: 1, line: 'UNBOTHERED BY MOST THINGS.' },
  { id: 'bold', name: 'BOLD', hunger: 1.15, joy: 1, bonus: 1.2, line: 'FIRST INTO EVERYTHING.' },
  { id: 'silly', name: 'SILLY', hunger: 1, joy: 1.2, bonus: 1.1, line: 'FINDS ITSELF HILARIOUS.' },
  { id: 'shy', name: 'SHY', hunger: 0.9, joy: 1, bonus: 0.9, line: 'WARMS UP SLOWLY. STAYS WARM.' },
  { id: 'grumpy', name: 'GRUMPY', hunger: 1.1, joy: 1.1, bonus: 1, line: 'LOVES YOU. WOULD NEVER SAY SO.' },
  { id: 'dreamy', name: 'DREAMY', hunger: 0.9, joy: 0.9, bonus: 0.95, line: 'HALF HERE, HALF SOMEWHERE NICE.' },
];

const PALATES = [
  { id: 'sweet', name: 'SWEET', line: 'WOULD LIVE ON MOCHI IF ALLOWED.' },
  { id: 'salty', name: 'SALTY', line: 'PICKLES. MORE PICKLES.' },
  { id: 'sour', name: 'SOUR', line: 'LIKES ITS FACE TO SCRUNCH.' },
  { id: 'spicy', name: 'SPICY', line: 'THE HOTTER THE HAPPIER.' },
  { id: 'umami', name: 'UMAMI', line: 'A SERIOUS EATER OF BROTH.' },
];

const COATS = [
  { id: 'sun', name: 'SUN', fill: 'sun', line: 'YELLOW AS A MORNING.' },
  { id: 'rose', name: 'ROSE', fill: 'rose', line: 'PINK. UNAPOLOGETIC.' },
  { id: 'sky', name: 'SKY', fill: 'sky', line: 'A CLEAR DAY BLUE.' },
  { id: 'moss', name: 'MOSS', fill: 'moss', line: 'GREEN, LIKE A SHADY WALL.' },
  { id: 'violet', name: 'VIOLET', fill: 'violet', line: 'THE COLOUR OF DUSK.' },
  { id: 'ember', name: 'EMBER', fill: 'ember', line: 'RED. RUNS HOT.' },
  { id: 'cream', name: 'CREAM', fill: 'cream', line: 'PALE AS RICE.' },
];

// Stages are by real days alive. There is no last one: an elder is a pet you
// kept for a month, and it keeps being kept.
const STAGES = [
  { id: 'baby', name: 'BABY', from: 0, scale: 0.6, line: 'JUST HATCHED. EATS, SLEEPS, WONDERS.' },
  { id: 'kid', name: 'KID', from: 1, scale: 0.78, line: 'ONE DAY OLD AND INTO EVERYTHING.' },
  { id: 'teen', name: 'TEEN', from: 3, scale: 0.9, line: 'THREE DAYS. HAS A CAP NOW.' },
  { id: 'adult', name: 'ADULT', from: 7, scale: 1, line: 'A WEEK. FULLY ITSELF.' },
  { id: 'elder', name: 'ELDER', from: 30, scale: 1, line: 'A MONTH. HAS SEEN THINGS.' },
];

// Name syllables. Two or three of them, never more than six letters -- that
// is what fits beside a level and a bean count on the HUD.
const SYLLABLES = ['KO', 'MI', 'TA', 'RU', 'NA', 'PO', 'YU', 'KI', 'MO', 'CHI', 'NE', 'SA',
  'HA', 'RI', 'TO', 'BU', 'PI', 'MA', 'NO', 'KA', 'SU', 'ME', 'YO', 'NI'];

// --- what it eats ------------------------------------------------------------
//
// RICE is free and endless, so a broke player can always keep a pet alive.
// Everything else is bought with beans and kept in the pantry. `kind` is meal
// or snack: snacks are joy, meals are food, and a diet of snacks is how you
// get a tummy ache.
const FOODS = [
  { id: 'rice', name: 'RICE', cost: 0, food: 30, joy: 2, weight: 2, kind: 'meal', palate: null, level: 1, line: 'PLAIN. RELIABLE. ALWAYS THERE.' },
  { id: 'onigiri', name: 'ONIGIRI', cost: 8, food: 40, joy: 6, weight: 3, kind: 'meal', palate: 'salty', level: 1, line: 'A TRIANGLE OF RICE WITH A SECRET.' },
  { id: 'miso', name: 'MISO SOUP', cost: 6, food: 25, joy: 8, weight: 1, kind: 'meal', palate: 'umami', level: 1, line: 'WARM ALL THE WAY DOWN.' },
  { id: 'pickles', name: 'PICKLES', cost: 5, food: 12, joy: 8, weight: 0, kind: 'snack', palate: 'sour', level: 1, line: 'CRUNCH. SCRUNCH.' },
  { id: 'dango', name: 'DANGO', cost: 7, food: 10, joy: 14, weight: 4, kind: 'snack', palate: 'sweet', level: 1, line: 'THREE ON A STICK, ALL DIFFERENT.' },
  { id: 'edamame', name: 'EDAMAME', cost: 5, food: 15, joy: 5, weight: 1, kind: 'snack', palate: 'salty', level: 2, line: 'POP THEM. THAT IS THE GAME.' },
  { id: 'udon', name: 'UDON', cost: 12, food: 55, joy: 10, weight: 5, kind: 'meal', palate: 'umami', level: 2, line: 'FAT NOODLES. SLURP LOUDLY.' },
  { id: 'taiyaki', name: 'TAIYAKI', cost: 9, food: 18, joy: 16, weight: 5, kind: 'snack', palate: 'sweet', level: 3, line: 'A FISH FULL OF BEAN PASTE.' },
  { id: 'curry', name: 'CURRY', cost: 14, food: 60, joy: 14, weight: 6, kind: 'meal', palate: 'spicy', level: 4, line: 'THE HOUSE IS WARM FOR HOURS.' },
  { id: 'tofu', name: 'TOFU', cost: 7, food: 28, joy: 4, weight: 1, kind: 'meal', palate: 'umami', level: 4, line: 'WOBBLES. DOES NOT MIND.' },
  { id: 'ramen', name: 'RAMEN', cost: 16, food: 70, joy: 18, weight: 7, kind: 'meal', palate: 'salty', level: 5, line: 'A WHOLE EVENING IN A BOWL.' },
  { id: 'mochi', name: 'MOCHI', cost: 8, food: 12, joy: 18, weight: 5, kind: 'snack', palate: 'sweet', level: 6, line: 'SOFT. CHEWY. THE BEST ONE.' },
  { id: 'umeboshi', name: 'UMEBOSHI', cost: 6, food: 8, joy: 12, weight: 0, kind: 'snack', palate: 'sour', level: 7, line: 'A PLUM THAT FIGHTS BACK.' },
  { id: 'tempura', name: 'TEMPURA', cost: 18, food: 55, joy: 20, weight: 8, kind: 'meal', palate: 'salty', level: 8, line: 'CRISP. EVERYTHING IS BETTER CRISP.' },
  { id: 'sushi', name: 'SUSHI', cost: 22, food: 50, joy: 24, weight: 3, kind: 'meal', palate: 'umami', level: 10, line: 'THE FANCY ONE. IT KNOWS.' },
  { id: 'kimchi', name: 'KIMCHI', cost: 9, food: 16, joy: 14, weight: 1, kind: 'snack', palate: 'spicy', level: 12, line: 'FERMENTED FIRE.' },
  { id: 'melonpan', name: 'MELON PAN', cost: 10, food: 26, joy: 16, weight: 6, kind: 'snack', palate: 'sweet', level: 14, line: 'NOT MELON. STILL WONDERFUL.' },
  { id: 'tea', name: 'GREEN TEA', cost: 4, food: 4, joy: 10, weight: 0, kind: 'snack', palate: 'sour', level: 1, line: 'FOR SITTING WITH.' },
];

// --- looking after it --------------------------------------------------------

const CARE = [
  { id: 'flush', name: 'FLUSH', line: 'CLEARS THE FLOOR. THANK YOU.' },
  { id: 'bath', name: 'BATH', line: 'BUBBLES. A SMALL PROTEST. CLEAN.' },
  { id: 'medicine', name: 'MEDICINE', line: 'TASTES TERRIBLE. WORKS.' },
  { id: 'tuck', name: 'TUCK IN', line: 'LIGHTS OFF. SLEEP TIGHT.' },
  { id: 'wake', name: 'WAKE UP', line: 'RISE AND SHINE. GRUMBLING.' },
  { id: 'praise', name: 'PRAISE', line: 'GOOD TOMO. THE BEST TOMO.' },
  { id: 'brush', name: 'BRUSH', line: 'SHINY. IT STANDS A LITTLE TALLER.' },
  { id: 'stretch', name: 'STRETCH', line: 'TOUCH YOUR TOES. IF YOU HAVE TOES.' },
];

const MINIGAMES = [
  { id: 'juggle', name: 'JUGGLE', track: 'juggle', line: 'KEEP THE BALL UP. A KICKS.' },
  { id: 'orchard', name: 'ORCHARD', track: 'orchard', line: 'CATCH WHAT FALLS. NOT THE ROTTEN.' },
  { id: 'echo', name: 'ECHO', track: 'echo', line: 'WATCH. THEN PLAY IT BACK.' },
];

const TOYS = [
  { id: 'ball', name: 'BALL', cost: 20, joy: 12, line: 'IT GOES UNDER THE BED. EVERY TIME.' },
  { id: 'yoyo', name: 'YOYO', cost: 25, joy: 14, line: 'UP. DOWN. UP. DOWN. STILL FUN.' },
  { id: 'kite', name: 'KITE', cost: 40, joy: 18, line: 'ONLY ON WINDY DAYS. WORTH THE WAIT.' },
  { id: 'blocks', name: 'BLOCKS', cost: 30, joy: 12, line: 'A TOWER. THEN NOT A TOWER.' },
  { id: 'drum', name: 'DRUM', cost: 45, joy: 16, line: 'THE NEIGHBOURS HAVE OPINIONS.' },
  { id: 'puzzle', name: 'PUZZLE', cost: 35, joy: 14, line: 'ONE PIECE IS ALWAYS MISSING.' },
  { id: 'train', name: 'TOY TRAIN', cost: 60, joy: 20, line: 'ROUND AND ROUND. CHOO.' },
  { id: 'telescope', name: 'TELESCOPE', cost: 80, joy: 22, line: 'THE MOON IS BIGGER THAN IT LOOKS.' },
];

const DECOR = [
  { id: 'rug', name: 'RUG', cost: 30, line: 'TIES THE ROOM TOGETHER.' },
  { id: 'plant', name: 'POT PLANT', cost: 25, line: 'GREEN. GROWING. NEEDS NOTHING.' },
  { id: 'lamp', name: 'LAMP', cost: 40, line: 'A WARMER KIND OF NIGHT.' },
  { id: 'poster', name: 'POSTER', cost: 20, line: 'OF A BAND YOU HAVE NOT HEARD OF.' },
  { id: 'shelf', name: 'BOOKSHELF', cost: 60, line: 'READ TWO OF THEM. PLANS TO READ MORE.' },
  { id: 'aquarium', name: 'AQUARIUM', cost: 90, line: 'ONE FISH. ITS NAME IS FISH.' },
  { id: 'radio', name: 'RADIO', cost: 50, line: 'ONLY GETS ONE STATION. A GOOD ONE.' },
  { id: 'clock', name: 'WALL CLOCK', cost: 35, line: 'TICKS. LATER THAN YOU THINK.' },
  { id: 'window', name: 'WINDOW BOX', cost: 45, line: 'FLOWERS, AND SOMEWHERE FOR A BIRD.' },
  { id: 'bunk', name: 'BUNK BED', cost: 120, line: 'TOP BUNK. OBVIOUSLY.' },
];

// --- what it grows into ------------------------------------------------------
//
// Pastimes unlock by level and are the reason to level. Each is a few seconds
// of animation and a line about what happened, drawn from `lines`; a pet that
// has done one enough times gets the last line, which is the good one.
const ACTIVITIES = [
  { id: 'doodle', name: 'DOODLING', level: 1, secs: 6, rest: 8, xp: 14, beans: 4, lines: ['DREW A CIRCLE. CALLED IT A SUN.', 'DREW YOU. YOU HAVE MORE ARMS.', 'DREW ITSELF. CHECKED A MIRROR. AGAIN.'] },
  { id: 'stars', name: 'STARGAZING', level: 2, secs: 7, rest: 6, xp: 16, beans: 4, lines: ['COUNTED ELEVEN STARS. LOST COUNT.', 'MADE UP A CONSTELLATION. THE SNACK.', 'ONE OF THEM BLINKED BACK.'] },
  { id: 'garden', name: 'GARDENING', level: 3, secs: 8, rest: 12, xp: 20, beans: 8, lines: ['PLANTED A BEAN. STILL WAITING.', 'PULLED A WEED. APOLOGISED TO IT.', 'GREW A RADISH THE SIZE OF ITS HEAD.'] },
  { id: 'origami', name: 'ORIGAMI', level: 4, secs: 7, rest: 8, xp: 22, beans: 7, lines: ['FOLDED A CRANE. IT LOOKS WORRIED.', 'FOLDED A FROG. IT JUMPED. ONCE.', 'A THOUSAND CRANES. MADE A WISH.'] },
  { id: 'kite', name: 'KITE FLYING', level: 5, secs: 8, rest: 12, xp: 24, beans: 8, lines: ['THE KITE FLEW. THE STRING DID NOT.', 'GOT IT ABOVE THE ROOF.', 'A BIRD SAT ON THE KITE. BOTH FINE.'] },
  { id: 'baking', name: 'BAKING', level: 6, secs: 9, rest: 10, xp: 26, beans: 12, lines: ['BAKED A BUN. ATE THE EVIDENCE.', 'THE BREAD ROSE. SO DID THE SMOKE.', 'MELON PAN. FROM SCRATCH. TRIUMPH.'] },
  { id: 'fishing', name: 'FISHING', level: 7, secs: 10, rest: 8, xp: 26, beans: 14, lines: ['CAUGHT A BOOT. THREW IT BACK.', 'CAUGHT NOTHING. HAD A LOVELY TIME.', 'CAUGHT A FISH. NAMED IT. RELEASED IT.'] },
  { id: 'pottery', name: 'POTTERY', level: 8, secs: 9, rest: 12, xp: 28, beans: 14, lines: ['MADE A BOWL. IT LEANS.', 'MADE A MUG. THE HANDLE IS DECORATIVE.', 'MADE A VASE SO FINE IT RINGS.'] },
  { id: 'birds', name: 'BIRDWATCHING', level: 9, secs: 8, rest: 6, xp: 26, beans: 10, lines: ['SAW A PIGEON. WROTE IT DOWN.', 'A SPARROW WATCHED BACK. STALEMATE.', 'A HERON. AN ACTUAL HERON.'] },
  { id: 'calligraphy', name: 'CALLIGRAPHY', level: 10, secs: 9, rest: 10, xp: 30, beans: 16, lines: ['WROTE ITS NAME. INK EVERYWHERE.', 'ONE PERFECT STROKE. THEN A SNEEZE.', 'WROTE FRIEND. HUNG IT ON THE WALL.'] },
  { id: 'programming', name: 'COMPUTER PROGRAMMING', short: 'PROGRAMMING', level: 11, secs: 10, rest: 14, xp: 36, beans: 22, lines: ['WROTE A BUG. NAMED IT. KEPT IT.', 'IT WORKS. NOBODY KNOWS WHY.', 'DELETED HALF THE CODE. IT GOT FASTER.', 'SHIPPED. THE SEMICOLONS HELD.'] },
  { id: 'bees', name: 'BEEKEEPING', level: 12, secs: 10, rest: 12, xp: 34, beans: 24, lines: ['THE BEES ARE FINE. TOMO IS PUFFY.', 'HARVESTED HONEY. SHARED SOME.', 'THE QUEEN NODDED. PROBABLY.'] },
  { id: 'radio', name: 'RADIO DJ', level: 13, secs: 9, rest: 10, xp: 34, beans: 20, lines: ['PLAYED ONE SONG THREE TIMES.', 'A LISTENER CALLED IN. IT WAS YOU.', 'THE LATE SHOW. ONLY THE OWLS.'] },
  { id: 'climb', name: 'MOUNTAINEERING', level: 14, secs: 11, rest: 20, xp: 40, beans: 26, lines: ['CLIMBED A HILL. CALLED IT A MOUNTAIN.', 'REACHED THE SNOW. ATE SOME.', 'THE SUMMIT. THE WHOLE WORLD, SMALL.'] },
  { id: 'robots', name: 'ROBOTICS', level: 15, secs: 10, rest: 14, xp: 40, beans: 28, lines: ['BUILT A ROBOT. IT WALKS INTO WALLS.', 'THE ROBOT MADE TEA. SORT OF.', 'THE ROBOT SAYS HELLO. EVERY MINUTE.'] },
  { id: 'opera', name: 'OPERA SINGING', level: 16, secs: 9, rest: 12, xp: 40, beans: 26, lines: ['HIT THE HIGH NOTE. THE GLASS HELD.', 'SANG THE SAD ONE. EVERYBODY CRIED.', 'AN ENCORE. THEN ANOTHER.'] },
  { id: 'diving', name: 'DEEP SEA DIVING', level: 17, secs: 11, rest: 16, xp: 44, beans: 30, lines: ['FOUND A SHELL. A SMALLER ONE INSIDE.', 'A FISH WITH A LANTERN. THEY WAVED.', 'THE BOTTOM. IT WAS FURTHER THAN THAT.'] },
  { id: 'digging', name: 'ARCHAEOLOGY', level: 18, secs: 11, rest: 16, xp: 44, beans: 32, lines: ['DUG UP A SPOON. ANCIENT SPOON.', 'FOUND A POT. IT LEANS. FAMILIAR.', 'A WHOLE LOST CITY. VERY SMALL.'] },
  { id: 'rockets', name: 'ROCKETRY', level: 19, secs: 10, rest: 14, xp: 46, beans: 34, lines: ['LAUNCHED. LANDED IN THE POND.', 'REACHED THE CLOUDS. CAME BACK WET.', 'ORBIT. WAVED AT THE MOON.'] },
  { id: 'science', name: 'RESEARCHING THE CURE FOR SCIENCE', short: 'CURING SCIENCE', level: 20, secs: 12, rest: 18, xp: 60, beans: 40, lines: ['SCIENCE IS NOW 3% CURED.', 'A BREAKTHROUGH, THEN A BREAKDOWN.', 'PEER REVIEW SAYS: MORE COWBELL.', 'SCIENCE IS CURED. IT WAS ALLERGIES.'] },
  { id: 'time', name: 'TIME TRAVEL', level: 21, secs: 10, rest: 16, xp: 50, beans: 36, lines: ['WENT TO TUESDAY. IT WAS TUESDAY.', 'MET ITSELF. THEY DID NOT GET ON.', 'CAME BACK WITH TOMORROW\'S SNACK.'] },
  { id: 'dragons', name: 'DRAGON TAMING', level: 22, secs: 11, rest: 20, xp: 54, beans: 40, lines: ['THE DRAGON IS SMALL. THE FIRE IS NOT.', 'IT SLEEPS ON THE ROOF NOW.', 'IT BROUGHT A FRIEND. ROOF IS FULL.'] },
  { id: 'clouds', name: 'CLOUD SCULPTING', level: 23, secs: 9, rest: 10, xp: 50, beans: 34, lines: ['MADE A RABBIT. IT DRIFTED OFF.', 'A WHOLE FLEET OF SHIPS. GONE BY NOON.', 'SCULPTED YOU. YOU LOOKED WELL.'] },
  { id: 'philosophy', name: 'PHILOSOPHY', level: 24, secs: 12, rest: 10, xp: 60, beans: 30, lines: ['WHAT IS A BEAN? ATE ONE. UNSURE.', 'IF A TOMO NAPS AND NOBODY SEES...', 'CONCLUDED: FOOD IS GOOD. PUBLISHED.'] },
];

// --- how it is --------------------------------------------------------------

const MOODS = [
  { id: 'ecstatic', name: 'ECSTATIC', line: 'CANNOT STOP BOUNCING.' },
  { id: 'happy', name: 'HAPPY', line: 'A GOOD DAY. IT SAYS SO.' },
  { id: 'content', name: 'CONTENT', line: 'FINE, THANKS. YOU?' },
  { id: 'bored', name: 'BORED', line: 'SIGHS. LOOKS AT THE DOOR.' },
  { id: 'hungry', name: 'HUNGRY', line: 'LOOKS AT THE BOWL. LOOKS AT YOU.' },
  { id: 'sleepy', name: 'SLEEPY', line: 'EYES HALF SHUT. SWAYING.' },
  { id: 'poorly', name: 'POORLY', line: 'NEEDS MEDICINE. LOOK IN CARE.' },
  { id: 'miserable', name: 'MISERABLE', line: 'EVERYTHING IS WRONG AT ONCE.' },
];

const ILLNESSES = [
  { id: 'sniffles', name: 'THE SNIFFLES', line: 'FROM A COLD NIGHT OR A DIRTY FLOOR.' },
  { id: 'tummy', name: 'TUMMY ACHE', line: 'TOO MANY SNACKS IN A ROW.' },
  { id: 'blues', name: 'THE BLUES', line: 'FROM BEING LEFT UNHAPPY TOO LONG.' },
  { id: 'hiccups', name: 'HICCUPS', line: 'FROM EATING TOO FAST. HIC.' },
];

const WEATHER = [
  { id: 'sun', name: 'SUNNY', line: 'THE WINDOW IS WARM TO TOUCH.' },
  { id: 'cloud', name: 'CLOUDY', line: 'A SOFT GREY LID ON THE DAY.' },
  { id: 'rain', name: 'RAINY', line: 'GOOD FOR NAPS AND WINDOWS.' },
  { id: 'snow', name: 'SNOWY', line: 'THE WORLD WENT QUIET.' },
  { id: 'storm', name: 'STORMY', line: 'KEEP IT INSIDE AND WARM.' },
];

// From the real calendar. `on(date)` gets {m, d} with m from 1.
const HOLIDAYS = [
  { id: 'newyear', name: 'NEW YEAR', gift: 50, on: ({ m, d }) => m === 1 && d === 1, line: 'A FRESH ONE. IT STAYED UP FOR IT.' },
  { id: 'valentine', name: 'VALENTINE', gift: 20, on: ({ m, d }) => m === 2 && d === 14, line: 'A CARD, UNSIGNED. IT WAS YOU.' },
  { id: 'hanami', name: 'HANAMI', gift: 25, on: ({ m, d }) => m === 4 && d <= 7, line: 'BLOSSOM WEEK. EVERYTHING IS PINK.' },
  { id: 'tanabata', name: 'TANABATA', gift: 25, on: ({ m, d }) => m === 7 && d === 7, line: 'A WISH ON A STRIP OF PAPER.' },
  { id: 'halloween', name: 'HALLOWEEN', gift: 30, on: ({ m, d }) => m === 10 && d === 31, line: 'IT DRESSED AS A GHOST. OR IS ONE.' },
  { id: 'yule', name: 'YULE', gift: 40, on: ({ m, d }) => m === 12 && d === 25, line: 'A SOCK ON THE WINDOWSILL.' },
  { id: 'hatchday', name: 'HATCHDAY', gift: 30, on: ({ d, born, days }) => days >= 1 && d === born, line: 'ANOTHER MONTH KEPT. CAKE.' },
];

const VISITORS = [
  { id: 'postman', name: 'THE POSTMAN', beans: 25, joy: 6, line: 'A LETTER! IT IS MOSTLY BEANS.' },
  { id: 'grandma', name: 'GRANDMA', beans: 10, joy: 14, food: 'onigiri', line: 'YOU ARE TOO THIN. HERE. EAT.' },
  { id: 'cat', name: 'A STRAY CAT', beans: 0, joy: 12, line: 'SAT ON THE RUG. OWNS THE RUG NOW.' },
  { id: 'neighbour', name: 'THE NEIGHBOUR', beans: 12, joy: 8, line: 'BORROWED SUGAR. RETURNED A CAKE.' },
  { id: 'pedlar', name: 'A TRAVELLING PEDLAR', beans: 0, joy: 10, food: 'mochi', line: 'RARE GOODS! WELL. MOCHI.' },
  { id: 'doctor', name: 'THE DOCTOR', beans: 0, joy: 4, cures: true, line: 'SAY AAH. SPLENDID. ALL BETTER.' },
  { id: 'penpal', name: 'A PENPAL', beans: 15, joy: 16, level: 5, line: 'A LETTER FROM FAR AWAY. STICKERS.' },
  { id: 'fan', name: 'A FAN', beans: 40, joy: 20, level: 15, line: 'WANTED AN AUTOGRAPH. GOT A PAW PRINT.' },
];

const DREAMS = [
  { id: 'flying', name: 'OF FLYING', line: 'OVER THE ROOFS. NO KITE NEEDED.' },
  { id: 'feast', name: 'OF A FEAST', line: 'EVERY FOOD AT ONCE. WOKE UP HUNGRY.' },
  { id: 'sea', name: 'OF THE SEA', line: 'SALT AND A VERY POLITE WHALE.' },
  { id: 'you', name: 'OF YOU', line: 'YOU WERE THERE. YOU HAD SNACKS.' },
  { id: 'giant', name: 'OF BEING HUGE', line: 'STEPPED OVER THE HOUSE. CAREFULLY.' },
  { id: 'tiny', name: 'OF BEING TINY', line: 'RODE A BEETLE TO THE SHOP.' },
  { id: 'moon', name: 'OF THE MOON', line: 'IT IS CHEESE. IT IS ALSO A FRIEND.' },
  { id: 'falling', name: 'OF FALLING', line: 'WOKE WITH A JOLT. CHECKED THE FLOOR.' },
  { id: 'school', name: 'OF SCHOOL', name2: null, line: 'FORGOT ITS HOMEWORK. HAD NO HOMEWORK.' },
  { id: 'rain', name: 'OF WARM RAIN', line: 'STOOD IN IT. DID NOT GET WET.' },
];

// Earned once, kept forever. `when(pet)` is checked after anything happens.
const BADGES = [
  { id: 'firstmeal', name: 'FIRST MEAL', hint: 'FEED IT ONCE', when: (p) => p.counts.meals + p.counts.snacks >= 1 },
  { id: 'clean10', name: 'CLEAN FREAK', hint: 'FLUSH TEN TIMES', when: (p) => p.counts.flushes >= 10 },
  { id: 'juggle10', name: 'TEN UP', hint: 'TEN JUGGLES IN A ROW', when: (p) => p.counts.juggleBest >= 10 },
  { id: 'juggle50', name: 'FIFTY UP', hint: 'FIFTY JUGGLES IN A ROW', when: (p) => p.counts.juggleBest >= 50 },
  { id: 'orchard30', name: 'FULL BASKET', hint: 'THIRTY POINTS IN ORCHARD', when: (p) => p.counts.orchardBest >= 30 },
  { id: 'echo8', name: 'GOOD EAR', hint: 'ECHO EIGHT ROUNDS', when: (p) => p.counts.echoBest >= 8 },
  { id: 'day1', name: 'ONE DAY OLD', hint: 'KEEP IT A DAY', when: (p) => p.age >= DAY },
  { id: 'week', name: 'ONE WEEK OLD', hint: 'KEEP IT A WEEK', when: (p) => p.age >= 7 * DAY },
  { id: 'month', name: 'ONE MONTH OLD', hint: 'KEEP IT A MONTH', when: (p) => p.age >= 30 * DAY },
  { id: 'lv5', name: 'LEVEL FIVE', hint: 'REACH LEVEL 5', when: (p) => p.level >= 5 },
  { id: 'lv10', name: 'LEVEL TEN', hint: 'REACH LEVEL 10', when: (p) => p.level >= 10 },
  { id: 'lv20', name: 'LEVEL TWENTY', hint: 'REACH LEVEL 20', when: (p) => p.level >= 20 },
  { id: 'gourmet', name: 'GOURMET', hint: 'TASTE EVERY FOOD', when: (p) => FOODS.every((f) => p.seen[`food:${f.id}`]) },
  { id: 'toybox', name: 'TOY BOX', hint: 'OWN EVERY TOY', when: (p) => TOYS.every((t) => p.toys.includes(t.id)) },
  { id: 'homely', name: 'HOMELY', hint: 'OWN EVERY DECORATION', when: (p) => DECOR.every((d) => p.decor.includes(d.id)) },
  { id: 'nightowl', name: 'NIGHT OWL', hint: 'VISIT AFTER MIDNIGHT', when: (p) => p.counts.nightVisits >= 1 },
  { id: 'earlybird', name: 'EARLY BIRD', hint: 'VISIT BEFORE SIX', when: (p) => p.counts.dawnVisits >= 1 },
  { id: 'streak7', name: 'SEVEN DAYS RUNNING', hint: 'VISIT SEVEN DAYS IN A ROW', when: (p) => p.counts.streak >= 7 },
  { id: 'doctor', name: 'BEDSIDE MANNER', hint: 'CURE FIVE ILLNESSES', when: (p) => p.counts.cures >= 5 },
  { id: 'scholar', name: 'SCHOLAR', hint: 'TWENTY PASTIMES', when: (p) => p.counts.activities >= 20 },
  { id: 'coder', name: 'PROGRAMMER', hint: 'PROGRAM TEN TIMES', when: (p) => (p.counts.did.programming ?? 0) >= 10 },
  { id: 'scientist', name: 'SCIENTIST', hint: 'CURE SCIENCE', when: (p) => p.counts.science >= 100 },
  { id: 'rich', name: 'BEAN BARON', hint: 'HOLD 500 BEANS', when: (p) => p.beans >= 500 },
  { id: 'survivor', name: 'SURVIVOR', hint: 'RECOVER FROM NEARLY GONE', when: (p) => p.counts.recovered >= 1 },
  { id: 'dreamer', name: 'DREAMER', hint: 'DREAM EVERY DREAM', when: (p) => DREAMS.every((d) => p.seen[`dream:${d.id}`]) },
  { id: 'host', name: 'GOOD HOST', hint: 'MEET EVERY VISITOR', when: (p) => VISITORS.every((v) => p.seen[`visitor:${v.id}`]) },
  { id: 'half', name: 'HALF THE BOOK', hint: 'SEE HALF THE ALMANAC', when: (p) => seenCount(p) * 2 >= FACETS.length },
  { id: 'all', name: 'THE WHOLE BOOK', hint: 'SEE ALL OF IT', when: (p) => seenCount(p) >= FACETS.length },
];

// Everything with a name, keyed `kind:id`. The almanac is a walk over this.
const KINDS = [
  ['body', 'BODIES', ARCHETYPES], ['temper', 'TEMPERS', TEMPERS], ['palate', 'PALATES', PALATES],
  ['coat', 'COATS', COATS], ['stage', 'STAGES', STAGES], ['food', 'FOODS', FOODS], ['care', 'CARE', CARE],
  ['game', 'GAMES', MINIGAMES], ['toy', 'TOYS', TOYS], ['decor', 'DECOR', DECOR],
  ['activity', 'PASTIMES', ACTIVITIES], ['mood', 'MOODS', MOODS], ['illness', 'AILMENTS', ILLNESSES],
  ['weather', 'WEATHER', WEATHER], ['holiday', 'HOLIDAYS', HOLIDAYS], ['visitor', 'VISITORS', VISITORS],
  ['dream', 'DREAMS', DREAMS], ['badge', 'BADGES', BADGES],
];
// What an entry says about itself: a line, a badge's hint, or a pastime's first outcome.
const lineOf = (item) => item.line ?? item.hint ?? (item.lines ? item.lines[0] : '');
const FACETS = KINDS.flatMap(([kind, , list]) => list.map((item) => ({ key: `${kind}:${item.id}`, kind, ...item, line: lineOf(item) })));
const seenCount = (pet) => FACETS.reduce((n, f) => n + (pet.seen[f.key] ? 1 : 0), 0);

const byId = (list, id) => list.find((item) => item.id === id);

// --- screens -----------------------------------------------------------------

const MENU = [
  { id: 'new', label: 'NEW TOMO' },
  { id: 'continue', label: 'CONTINUE' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'quit', label: 'SAVE AND QUIT' },
];
const HOW_TO = [
  'TOMO LIVES ON THE CLOCK. IT GETS',
  'HUNGRY WHILE YOU ARE AWAY, AND IF',
  'NOBODY FEEDS IT, IT WILL NOT LAST.',
  'LEFT AND RIGHT PICK, A CHOOSES, B',
  'PATS. SELECT TURNS THE LIGHTS OFF.',
  'FLUSH THE FLOOR. GAMES EARN BEANS',
  'AND XP. LEVELS UNLOCK PASTIMES. THE',
  'BOOK COUNTS EVERYTHING YOU MEET.',
];
const CREATE_ROWS = ['name', 'temper', 'palate', 'coat', 'hatch'];
const HOME_ICONS = [
  { id: 'feed', label: 'FEED' }, { id: 'play', label: 'PLAY' }, { id: 'care', label: 'CARE' },
  { id: 'work', label: 'WORK' }, { id: 'shop', label: 'SHOP' }, { id: 'book', label: 'BOOK' },
];
const SHOP_TABS = [['FOOD', FOODS.filter((f) => f.cost > 0)], ['TOYS', TOYS], ['DECOR', DECOR]];

// mulberry32, as in every other game here.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (random, list) => list[Math.floor(random() * list.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rect = (x, y, w, h, fill) => ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x, y, r, fill });
const chain = (points, fill) => ({ type: 'chain', points, fill });

function makeName(random) {
  for (;;) {
    const n = random() < 0.6 ? 2 : 3;
    let name = '';
    for (let i = 0; i < n; i++) name += pick(random, SYLLABLES);
    if (name.length <= 6) return name;
  }
}

// A body's particulars, rolled once. Everything the drawing needs that is
// not the archetype: where the eyes sit, whether it has ears, how many spots.
function makeLook(random) {
  return {
    archetype: pick(random, ARCHETYPES).id,
    eyeGap: 0.3 + random() * 0.3,
    eyeR: 0.09 + random() * 0.07,
    eyeY: -0.05 + random() * 0.25,
    ears: Math.floor(random() * 3),        // 0, 1 (an antenna) or 2
    wide: 0.9 + random() * 0.25,
    tall: 0.9 + random() * 0.25,
    spots: Math.floor(random() * 4),
    spotSeed: Math.floor(random() * 1e9),
    cheeks: random() < 0.5,
    tuft: random() < 0.5,
  };
}

// Weather is a function of the calendar date, so a day's weather cannot be
// changed by anything the player does and every load agrees on it. Snow only
// in the winter months, storms rare.
function weatherFor({ y, m, d }) {
  const random = rng(((y * 372 + m * 31 + d) * 7919) >>> 0);
  const roll = random();
  const winter = m === 12 || m <= 2;
  if (roll < 0.05) return 'storm';
  if (winter && roll < 0.35) return 'snow';
  if (roll < 0.25) return 'rain';
  if (roll < 0.55) return 'cloud';
  return 'sun';
}

// Local calendar date and seconds since midnight, from a wall-clock ms value.
function calendar(ms) {
  const at = new Date(ms);
  return {
    date: { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() },
    clock: at.getHours() * HOUR + at.getMinutes() * MINUTE + at.getSeconds(),
  };
}
function nextDate({ y, m, d }) {
  const at = new Date(y, m - 1, d + 1);
  return { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() };
}
const dayNumber = ({ y, m, d }) => Math.round(new Date(y, m - 1, d).getTime() / (DAY * 1000));

// The default save store, beside the high score table for the same reason
// scores.js gives. Tests pass memoryStore().
const fileStore = {
  load() {
    try { return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch { return null; }
  },
  write(data) {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(data));
  },
};

function memoryStore(initial = null) {
  let data = initial ? JSON.stringify(initial) : null;
  return { load: () => (data ? JSON.parse(data) : null), write(next) { data = JSON.stringify(next); }, get raw() { return data; } };
}

const clockText = (seconds) => {
  const h = Math.floor(seconds / HOUR) % 24;
  const m = Math.floor(seconds / MINUTE) % 60;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, '0')}${h < 12 ? 'AM' : 'PM'}`;
};
const spanText = (seconds) => {
  const d = Math.floor(seconds / DAY);
  const h = Math.floor((seconds % DAY) / HOUR);
  const m = Math.floor((seconds % HOUR) / MINUTE);
  if (d > 0) return `${d}D ${h}H`;
  if (h > 0) return `${h}H ${m}M`;
  return `${m}M`;
};

// --- the game ----------------------------------------------------------------

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const table = options.scores ?? scores;
  const store = options.save ?? fileStore;
  const clock = options.clock ?? Date.now;
  const seed = options.seed ?? 0x544f4d4f;
  const random = rng(seed);

  const sounds = [];
  const say = (name) => sounds.push(name);

  let pet = null;        // the live pet, or null
  let memorial = [];     // the pets that came before, oldest first

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,          // seconds in this screen
    t: 0,                // seconds since create(); drives the idle animation
    cursor: 0,
    icon: 0,             // the home screen's ring
    tab: 0,              // care: 0 food, 1 care. shop: which shelf
    page: 0,             // almanac
    draft: null,         // the create screen
    note: null,          // { text, left } -- one line under the room
    cards: [],           // modal cards, shown one at a time until A
    act: null,           // { kind, left, total } -- what the pet is doing
    dream: null,         // { id, left }
    mini: null,          // the running minigame
    result: null,        // the last minigame's outcome
    work: null,          // { id, left, total }
    fallen: null,        // the dead screen's subject
    from: 'menu',        // where HOW TO PLAY goes back to
    sinceSave: 0,
    played: 0,           // seconds of play since the last save, for drift
    sinceVisit: 0,
    sinceDream: 0,
    sincePat: PAT_COOLDOWN,
    saves: 0,
    peek: null,          // what the menu says about the save file
  };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; game.cursor = 0; };
  const note = (text, secs = 2.2) => { game.note = { text, left: secs }; };
  const card = (title, lines, extra = {}) => { game.cards.push({ title, lines, ...extra }); };

  // --- what it is -----------------------------------------------------------

  const stageOf = (p = pet) => {
    let stage = STAGES[0];
    for (const s of STAGES) if (p.age >= s.from * DAY) stage = s;
    return stage;
  };
  const isNight = (p = pet) => { const h = p.clock / HOUR; return h >= BEDTIME || h < WAKE_HOUR; };
  const cleanOf = (p = pet) => clamp(100 - p.messes * 34, 0, 100);
  const weather = (p = pet) => weatherFor(p.date);

  // Read off the stats, worst thing first: a hungry, sleepy pet is hungry.
  const moodOf = (p = pet) => {
    if (p.health < 40 || (p.sick && p.health < 70)) return 'miserable';
    if (p.sick) return 'poorly';
    if (p.food < 25) return 'hungry';
    if (p.rest < 25 && !p.asleep) return 'sleepy';
    if (p.joy < 30) return 'bored';
    const sum = p.food + p.joy + p.rest + p.health;
    if (sum > 360 && p.messes === 0) return 'ecstatic';
    if (sum > 280) return 'happy';
    return 'content';
  };

  const see = (key) => {
    if (!pet || pet.seen[key]) return false;
    pet.seen[key] = true;
    return true;
  };
  // A discovery worth a line: things the player did not choose off a list.
  const discover = (kind, item) => {
    if (see(`${kind}:${item.id}`) && game.screen !== 'menu') { note(`NEW IN THE BOOK: ${item.name}`); say('pickup'); }
  };

  function checkBadges() {
    for (const badge of BADGES) {
      if (pet.badges.includes(badge.id) || !badge.when(pet)) continue;
      pet.badges.push(badge.id);
      pet.seen[`badge:${badge.id}`] = true;
      card('BADGE EARNED', [badge.name, badge.hint], { sound: 'bell' });
    }
  }

  function gainXp(n) {
    pet.xp += n;
    while (pet.xp >= xpFor(pet.level)) {
      pet.xp -= xpFor(pet.level);
      pet.level++;
      const unlocked = [
        ...ACTIVITIES.filter((a) => a.level === pet.level).map((a) => a.name),
        ...FOODS.filter((f) => f.level === pet.level).map((f) => `${f.name} IN THE SHOP`),
      ];
      card(`LEVEL ${pet.level}`, unlocked.length ? ['UNLOCKED:', ...unlocked.slice(0, 2)] : ['A LITTLE WISER.'], { sound: 'fanfare' });
    }
  }

  // --- the pet's life ---------------------------------------------------------

  function newDraft() {
    return {
      name: makeName(random),
      temper: Math.floor(random() * TEMPERS.length),
      palate: Math.floor(random() * PALATES.length),
      coat: Math.floor(random() * COATS.length),
      // The egg's freckles, so the create screen is a picture of this seed.
      freckles: Array.from({ length: 5 }, () => [random() * 2 - 1, random() * 2 - 1]),
    };
  }

  function hatch() {
    const now = clock();
    const { date, clock: sod } = calendar(now);
    const d = game.draft;
    pet = {
      version: SAVE_VERSION,
      name: d.name,
      temper: TEMPERS[d.temper].id,
      palate: PALATES[d.palate].id,
      coat: COATS[d.coat].id,
      look: makeLook(random),
      bornAt: now, savedAt: now, bornDay: date.d,
      age: 0, clock: sod, date,
      food: 80, joy: 70, rest: 90, health: 100, weight: 30,
      asleep: false, sleptFor: 0, napBlock: 0,
      digest: -1, messes: 0, messFor: 0,
      sick: null, sickFor: 0, snacksRow: 0, sadFor: 0, lastMeal: -1e9,
      xp: 0, level: 1, beans: BEANS_START,
      pantry: { onigiri: 2, dango: 1 },
      toys: [], decor: [],
      seen: {}, badges: [],
      lowest: 100,
      holidayDay: null,
      counts: {
        meals: 0, snacks: 0, flushes: 0, baths: 0, cures: 0, games: 0, activities: 0, toys: 0,
        juggleBest: 0, orchardBest: 0, echoBest: 0, science: 0, did: {},
        visits: 0, streak: 1, lastVisitDay: dayNumber(date), nightVisits: 0, dawnVisits: 0,
        recovered: 0, praises: 0, pats: 0, dreams: 0,
      },
    };
    for (const [kind, id] of [['body', pet.look.archetype], ['temper', pet.temper], ['palate', pet.palate], ['coat', pet.coat]]) see(`${kind}:${id}`);
    game.dream = null;
    game.act = null;
    game.cards = [];
    game.sinceVisit = 0;
    game.sinceDream = 0;
    arrive(now, null);
    save();
  }

  // Things that happen when the player turns up: the streak, the time-of-day
  // badges, today's weather and holiday. Not in tick(), because they are about
  // *you* being here, and catching up on a week away must not count as seven
  // visits.
  function arrive(now, away) {
    const c = pet.counts;
    const today = dayNumber(pet.date);
    if (today === c.lastVisitDay + 1) { c.streak++; gainXp(10 * Math.min(7, c.streak)); note(`${c.streak} DAYS RUNNING. +XP`); }
    else if (today > c.lastVisitDay + 1) c.streak = 1;
    c.lastVisitDay = today;
    const hour = pet.clock / HOUR;
    if (hour < 4) c.nightVisits++;
    else if (hour < 6) c.dawnVisits++;

    discover('stage', stageOf());
    discover('weather', byId(WEATHER, weather()));
    discover('mood', byId(MOODS, moodOf()));
    checkHoliday();
    if (away) {
      const lines = [`GONE ${spanText(away.seconds)}.`];
      if (away.messes) lines.push(`${away.messes} MESS${away.messes > 1 ? 'ES' : ''} ON THE FLOOR.`);
      if (away.sick) lines.push(`CAUGHT ${byId(ILLNESSES, away.sick).name}.`);
      if (pet.food <= 0) lines.push('STARVING. FEED IT NOW.');
      else if (pet.food < 30) lines.push('VERY HUNGRY.');
      if (away.slept) lines.push('SLEPT SOME OF IT.');
      if (lines.length === 1) lines.push('MISSED YOU. OTHERWISE FINE.');
      card('WHILE YOU WERE AWAY', lines);
      // Somebody may have called while you were out. Grandma always does, the
      // first time, so a new owner meets a visitor on their first day back.
      if (!pet.asleep && (pet.counts.visits === 0 || random() < 0.35)) visit();
    }
    checkBadges();
  }

  function checkHoliday() {
    const today = dayNumber(pet.date);
    const when = { ...pet.date, born: pet.bornDay, days: pet.age / DAY };
    const holiday = HOLIDAYS.find((h) => h.on(when));
    if (!holiday) return;
    discover('holiday', holiday);
    if (pet.holidayDay === today) return;
    pet.holidayDay = today;
    pet.beans += holiday.gift;
    pet.joy = Math.min(100, pet.joy + 15);
    card(holiday.name, [holiday.line, `A GIFT OF ${holiday.gift} BEANS.`], { sound: 'bell' });
  }

  // --- saving ---------------------------------------------------------------

  function save() {
    if (pet) {
      const now = clock();
      // The frame loop reports lateness rather than dropping frames, so on a
      // slow evening the pet's clock falls behind the wall's. Catch it up.
      const drift = (now - pet.savedAt) / 1000 - game.played;
      if (drift > 2 * MINUTE) catchUp(drift, null);
      pet.savedAt = now;
    }
    game.played = 0;
    game.sinceSave = 0;
    game.saves++;
    store.write({ version: SAVE_VERSION, pet, memorial });
  }

  function peek() {
    const data = store.load();
    if (!data || data.version !== SAVE_VERSION) return null;
    memorial = Array.isArray(data.memorial) ? data.memorial : [];
    return data.pet && data.pet.name ? data.pet : null;
  }

  function load() {
    const saved = peek();
    if (!saved) return false;
    pet = saved;
    const now = clock();
    const away = Math.max(0, (now - pet.savedAt) / 1000);
    const log = { seconds: away, messes: 0, sick: null, slept: false, died: null };
    catchUp(away, log);
    pet.savedAt = now;
    game.dream = null;
    game.act = null;
    game.cards = [];
    game.sinceVisit = 0;
    game.sinceDream = 0;
    if (pet.dead) { retire(pet.dead, log); return true; }
    arrive(now, away >= 5 * MINUTE ? log : null);
    save();
    return true;
  }

  // Runs the clockwork over time that passed with nobody watching, in steps
  // short enough that bedtime lands on the right hour. Capped: a month is as
  // dead as a year, and there is no need to simulate the year.
  function catchUp(seconds, log) {
    let left = Math.min(seconds, CATCH_UP_MAX);
    while (left > 0 && !pet.dead) {
      const step = Math.min(CATCH_UP_STEP, left);
      tick(step, log);
      left -= step;
    }
  }

  // --- the clockwork ------------------------------------------------------------

  function sleep() { pet.asleep = true; pet.sleptFor = 0; }
  function wake() { pet.asleep = false; game.dream = null; }

  function fallIll(id, log) {
    pet.sick = id;
    pet.sickFor = 0;
    if (log) log.sick = id;
    else { discover('illness', byId(ILLNESSES, id)); note(`${pet.name} HAS ${byId(ILLNESSES, id).name}`, 3); say('sneeze'); }
  }

  function tick(dt, log = null) {
    const p = pet;
    const h = dt / HOUR;
    const temper = byId(TEMPERS, p.temper);
    p.age += dt;
    p.clock += dt;
    while (p.clock >= DAY) {
      p.clock -= DAY;
      p.date = nextDate(p.date);
      if (!log) { discover('weather', byId(WEATHER, weather())); checkHoliday(); }
    }
    if (p.napBlock > 0) p.napBlock -= dt;

    // Bed. It puts itself down at night and gets up in the morning; a daytime
    // nap ends when it is rested.
    const night = isNight(p);
    if (!p.asleep && night && p.napBlock <= 0) { sleep(); if (log) log.slept = true; }
    if (p.asleep) {
      p.sleptFor += dt;
      if (!night && (p.rest >= 99 || p.sleptFor >= 8 * HOUR)) wake();
    }

    p.food = Math.max(0, p.food - RATE.food * temper.hunger * (p.asleep ? 0.5 : 1) * h);
    p.joy = Math.max(0, p.joy - RATE.joy * temper.joy * (p.asleep ? 0.4 : 1) * h);
    if (p.asleep) p.rest = Math.min(100, p.rest + RATE.restAsleep * h);
    else p.rest = Math.max(0, p.rest - RATE.restAwake * h);

    if (p.digest >= 0) {
      p.digest += dt;
      if (p.digest >= DIGEST) {
        p.digest = -1;
        if (p.messes < MAX_MESS) { p.messes++; if (log) log.messes++; else say('plop'); }
      }
    }

    // Illness. A dirty floor or a long sulk each bring one on after a while.
    // Asleep, it is not walking through the mess, so the night does not count:
    // otherwise every morning started with the sniffles.
    if (p.messes > 0) { if (!p.asleep) p.messFor += dt; if (!p.sick && p.messFor >= SICK_AFTER) fallIll('sniffles', log); }
    else p.messFor = 0;
    if (p.joy <= 0) { p.sadFor += dt; if (!p.sick && p.sadFor >= 6 * HOUR) fallIll('blues', log); }
    else p.sadFor = 0;
    if (p.sick) p.sickFor += dt;

    let harm = 0;
    const causes = [];
    if (p.food <= 0) { harm += RATE.starve; causes.push('starved'); }
    if (p.messes > 0) { harm += RATE.dirty; causes.push('neglected'); }
    if (p.sick) { harm += RATE.sick; causes.push('poorly'); }
    if (p.joy <= 0) { harm += RATE.sad; causes.push('heartbroken'); }
    if (harm > 0) p.health = Math.max(0, p.health - harm * h);
    else if (p.food > 20) {
      p.health = Math.min(100, p.health + RATE.mend * h);
      if (p.lowest < 15 && p.health >= 60) { p.counts.recovered++; p.lowest = 100; }
    }
    p.lowest = Math.min(p.lowest, p.health);
    if (p.food <= 0) p.weight = Math.max(5, p.weight - 0.6 * h);

    if (p.health <= 0 && !p.dead) p.dead = causes[0] ?? 'poorly';
  }

  const EPITAPHS = {
    starved: 'NOBODY CAME WITH THE BOWL.',
    neglected: 'THE FLOOR WAS NEVER FLUSHED.',
    poorly: 'IT NEEDED MEDICINE. NONE CAME.',
    heartbroken: 'IT WAITED TO BE PLAYED WITH.',
  };

  function retire(cause) {
    const days = Math.floor(pet.age / DAY);
    game.fallen = { name: pet.name, days, level: pet.level, cause, look: pet.look, coat: pet.coat, age: pet.age, seen: seenCount(pet) };
    memorial.push({ name: pet.name, days, level: pet.level, cause });
    if (days > 0) table.record(GAME, pet.name.slice(0, 3), days);
    pet = null;
    game.cards = [];
    store.write({ version: SAVE_VERSION, pet: null, memorial });
    say('over');
    go('dead');
  }

  // --- what you can do --------------------------------------------------------

  const asleepNote = () => { note(`${pet.name} IS ASLEEP. SELECT WAKES IT.`); say('back'); };
  const act = (kind, secs) => { game.act = { kind, left: secs, total: secs }; };

  function feed(food) {
    if (pet.asleep) return asleepNote();
    if (pet.food >= FULL) { note('TOO FULL. MAYBE LATER.'); say('back'); return; }
    if (food.cost > 0 && !(pet.pantry[food.id] > 0)) { note('NONE LEFT. THE SHOP HAS SOME.'); say('back'); return; }
    if (food.cost > 0) pet.pantry[food.id]--;
    const favourite = food.palate === pet.palate;
    pet.food = Math.min(100, pet.food + food.food);
    pet.joy = Math.min(100, pet.joy + food.joy * (favourite ? 2 : 1));
    pet.weight = Math.min(99, pet.weight + food.weight);
    pet.digest = 0;
    if (food.kind === 'snack') { pet.counts.snacks++; pet.snacksRow++; }
    else { pet.counts.meals++; pet.snacksRow = 0; }
    if (!pet.sick && pet.snacksRow >= 4) fallIll('tummy', null);
    else if (!pet.sick && pet.age - pet.lastMeal < 45 && food.kind === 'meal') fallIll('hiccups', null);
    pet.lastMeal = pet.age;
    see(`food:${food.id}`);
    gainXp(food.kind === 'meal' ? 4 : 2);
    if (favourite) note(`${food.name}! ITS FAVOURITE KIND.`);
    else note(`${pet.name} ATE THE ${food.name}.`);
    act('eat', 1.4);
    say('munch');
    checkBadges();
  }

  function care(id) {
    switch (id) {
      case 'flush':
        if (pet.messes === 0) { note('NOTHING TO FLUSH. LOVELY.'); say('back'); return; }
        pet.messes = 0; pet.messFor = 0; pet.counts.flushes++;
        gainXp(4); say('flush'); note('FLUSHED. THE ROOM BREATHES.');
        break;
      case 'bath':
        if (pet.asleep) return asleepNote();
        pet.counts.baths++; pet.messFor = 0;
        pet.joy = Math.min(100, pet.joy + 6);
        gainXp(4); act('bath', 1.6); say('sprinkle'); note('BUBBLES EVERYWHERE. CLEAN.');
        break;
      case 'medicine':
        if (!pet.sick) { note('NOT POORLY. SPAT IT OUT.'); pet.joy = Math.max(0, pet.joy - 3); say('back'); return; }
        pet.counts.cures++; pet.sick = null; pet.sickFor = 0; pet.snacksRow = 0;
        pet.health = Math.min(100, pet.health + 10);
        gainXp(8); act('heal', 1.2); say('heal'); note('ALL BETTER. IT FORGIVES YOU.');
        break;
      case 'tuck':
        if (pet.asleep) { note('ALREADY ASLEEP. SHH.'); say('back'); return; }
        if (pet.rest >= SLEEPY && !isNight()) { note('NOT SLEEPY. TRY A GAME.'); say('back'); return; }
        sleep(); pet.napBlock = 0; say('snooze'); note('LIGHTS OFF. SLEEP TIGHT.');
        break;
      case 'wake':
        if (!pet.asleep) { note('ALREADY UP.'); say('back'); return; }
        wake(); pet.napBlock = 2 * HOUR; pet.joy = Math.max(0, pet.joy - 4); say('rooster'); note('UP. GRUMBLING.');
        break;
      case 'praise':
        if (pet.asleep) return asleepNote();
        pet.counts.praises++;
        pet.joy = Math.min(100, pet.joy + 8);
        gainXp(3); act('hearts', 1.2); say('talk'); note(`GOOD ${pet.name}. THE BEST ${pet.name}.`);
        break;
      case 'brush':
        if (pet.asleep) return asleepNote();
        pet.joy = Math.min(100, pet.joy + 5);
        gainXp(3); act('brush', 1.4); say('chip'); note('SHINY. IT STANDS A LITTLE TALLER.');
        break;
      case 'stretch':
        if (pet.asleep) return asleepNote();
        pet.joy = Math.min(100, pet.joy + 4);
        pet.weight = Math.max(5, pet.weight - 1);
        gainXp(3); act('stretch', 1.4); say('bounce'); note('REACHED FOR THE CEILING. NEARLY.');
        break;
      default:
        throw new Error(`unknown care: ${id}`);
    }
    see(`care:${id}`);
    checkBadges();
  }

  function pat() {
    if (game.sincePat < PAT_COOLDOWN) return;
    if (pet.asleep) { note('SHH. IT IS DREAMING.', 1.2); return; }
    game.sincePat = 0;
    pet.counts.pats++;
    pet.joy = Math.min(100, pet.joy + 2);
    act('hearts', 1);
    say('talk');
  }

  // Can it play? Every game and pastime asks this first.
  function fit(restNeeded = TIRED) {
    if (pet.asleep) { asleepNote(); return false; }
    if (pet.food < HUNGRY) { note('TOO HUNGRY TO PLAY. FEED IT.'); say('back'); return false; }
    if (pet.rest < restNeeded) { note('TOO TIRED TO PLAY. LET IT SLEEP.'); say('back'); return false; }
    return true;
  }

  function playToy(toy) {
    if (!fit()) return;
    pet.counts.toys++;
    pet.joy = Math.min(100, pet.joy + toy.joy);
    pet.rest = Math.max(0, pet.rest - 4);
    gainXp(5);
    see(`toy:${toy.id}`);
    act('toy', 1.6);
    say('bounce');
    note(`PLAYED WITH THE ${toy.name}. ${toy.line}`.slice(0, 38));
    checkBadges();
  }

  function startWork(activity) {
    if (pet.level < activity.level) { note(`NEEDS LEVEL ${activity.level}.`); say('back'); return; }
    if (!fit(activity.rest)) return;
    game.work = { id: activity.id, left: activity.secs, total: activity.secs };
    say('select');
    go('working');
  }

  function finishWork() {
    const activity = byId(ACTIVITIES, game.work.id);
    const c = pet.counts;
    c.activities++;
    c.did[activity.id] = (c.did[activity.id] ?? 0) + 1;
    const n = c.did[activity.id];
    if (activity.id === 'science') c.science = Math.min(100, c.science + 12);
    pet.rest = Math.max(0, pet.rest - activity.rest);
    pet.weight = Math.max(5, pet.weight - 1);
    pet.joy = Math.min(100, pet.joy + 6);
    pet.beans += activity.beans;
    gainXp(activity.xp);
    see(`activity:${activity.id}`);
    const last = activity.lines.length - 1;
    const line = n >= 6 ? activity.lines[last] : activity.lines[(n - 1) % last];
    const extra = activity.id === 'science' ? `SCIENCE IS ${c.science}% CURED.` : `+${activity.xp} XP  +${activity.beans} BEANS`;
    card(activity.name.length > 20 ? 'RESEARCH DONE' : activity.name, [line, extra], { sound: 'ding' });
    game.work = null;
    checkBadges();
    go('home');
    save();
  }

  function buy(item, kind) {
    if (pet.beans < item.cost) { note('NOT ENOUGH BEANS. PLAY A GAME.'); say('back'); return; }
    if (kind === 'toy' && pet.toys.includes(item.id)) { note('ALREADY HAVE ONE.'); say('back'); return; }
    if (kind === 'decor' && pet.decor.includes(item.id)) { note('ALREADY ON THE WALL.'); say('back'); return; }
    if (kind === 'food' && pet.level < item.level) { note(`NEEDS LEVEL ${item.level}.`); say('back'); return; }
    pet.beans -= item.cost;
    if (kind === 'food') pet.pantry[item.id] = (pet.pantry[item.id] ?? 0) + 1;
    else if (kind === 'toy') { pet.toys.push(item.id); see(`toy:${item.id}`); }
    else { pet.decor.push(item.id); see(`decor:${item.id}`); }
    say('coin');
    note(`BOUGHT ${item.name}.`);
    checkBadges();
  }

  // --- company ------------------------------------------------------------------

  function visit() {
    const c = pet.counts;
    const eligible = VISITORS.filter((v) => (v.level ?? 0) <= pet.level && (!v.cures || pet.sick));
    const who = c.visits === 0 ? byId(VISITORS, 'grandma') : pick(random, eligible);
    c.visits++;
    pet.beans += who.beans;
    pet.joy = Math.min(100, pet.joy + who.joy);
    if (who.food) pet.pantry[who.food] = (pet.pantry[who.food] ?? 0) + 1;
    if (who.cures && pet.sick) { pet.sick = null; pet.sickFor = 0; c.cures++; }
    see(`visitor:${who.id}`);
    gainXp(5);
    const gift = who.food ? `LEFT SOME ${byId(FOODS, who.food).name}.` : who.beans ? `LEFT ${who.beans} BEANS.` : 'LEFT NOTHING BUT A GOOD MOOD.';
    card(`${who.name} CAME BY`, [who.line, gift], { sound: 'door' });
    checkBadges();
  }

  function dream() {
    const which = pick(random, DREAMS);
    pet.counts.dreams++;
    game.dream = { id: which.id, left: 20 };
    discover('dream', which);
    checkBadges();
  }

  // The live pet's frame: the clockwork plus everything that only happens when
  // somebody is watching.
  function live(dt) {
    tick(dt, null);
    game.sinceSave += dt;
    game.played += dt;
    game.sincePat += dt;
    if (pet.dead) { retire(pet.dead); return; }

    if (game.act) { game.act.left -= dt; if (game.act.left <= 0) game.act = null; }
    if (game.dream) { game.dream.left -= dt; if (game.dream.left <= 0) game.dream = null; }

    if (game.screen === 'home') {
      if (pet.asleep) {
        game.sinceDream += dt;
        if (game.sinceDream >= DREAM_EVERY) { game.sinceDream = 0; dream(); }
      } else if (!game.cards.length) {
        game.sinceVisit += dt;
        const due = pet.counts.visits === 0 ? 3 * MINUTE : VISIT_EVERY;
        if (game.sinceVisit >= due) { game.sinceVisit = 0; if (pet.counts.visits === 0 || random() < VISIT_CHANCE) visit(); }
      }
    }
    if (Math.floor(game.t) !== Math.floor(game.t - dt)) { discover('mood', byId(MOODS, moodOf())); discover('stage', stageOf()); checkBadges(); }
    if (game.sinceSave >= SAVE_EVERY) save();
  }

  // --- the minigames ---------------------------------------------------------------
  //
  // Three of them, each one screen and under a minute, all scored by a
  // number the almanac keeps the best of. They share the pet, the floor and
  // the walk speed -- a heavy pet is a slow one, which is the diet.

  const FIELD = { floor: court.y + court.h - 66, left: court.x + 50, right: court.x + court.w - 50 };
  const BALL_R = 13;
  const DIRS = ['up', 'right', 'down', 'left'];
  const ECHO_SOUND = { up: 'paddle', right: 'edge', down: 'wall', left: 'move' };
  const REWARD = { juggle: { xp: 2, beans: 1, joy: 1.5 }, orchard: { xp: 1.5, beans: 0.8, joy: 1 }, echo: { xp: 6, beans: 3, joy: 3 } };
  const petSpeed = () => (pet.weight > 60 ? 200 : 270);

  function startGame(spec) {
    if (!fit()) return;
    see(`game:${spec.id}`);
    const m = { id: spec.id, over: false, overFor: 0, score: 0 };
    if (spec.id === 'juggle') Object.assign(m, { x: mid.x, ball: { x: mid.x + 12, y: FIELD.floor - 230, vx: 0, vy: 0 }, gravity: 520, kick: 0, perfect: 0 });
    if (spec.id === 'orchard') Object.assign(m, { x: mid.x, left: 40, fruit: [], spawnIn: 0.6, caught: 0, missed: 0, sour: 0 });
    if (spec.id === 'echo') Object.assign(m, { seq: [pick(random, DIRS)], round: 0, phase: 'show', index: 0, timer: 0.8, flash: null, wrong: null });
    game.mini = m;
    say('serve');
    go(spec.id);
  }

  function juggle(dt, pad) {
    const m = game.mini;
    if (m.over) { m.overFor += dt; if (m.overFor >= 1.2) finishGame(); return; }
    let dx = 0;
    if (pad.left) dx -= 1;
    if (pad.right) dx += 1;
    m.x = clamp(m.x + dx * petSpeed() * dt, FIELD.left, FIELD.right);
    if (m.kick > 0) m.kick -= dt;

    const b = m.ball;
    b.vy += m.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < court.x + BALL_R) { b.x = court.x + BALL_R; b.vx = Math.abs(b.vx); say('wall'); }
    if (b.x > court.x + court.w - BALL_R) { b.x = court.x + court.w - BALL_R; b.vx = -Math.abs(b.vx); say('wall'); }

    // The kick zone is the last stretch of the fall over the foot. Near the
    // ground is a PERFECT and worth two; the ball goes up harder the longer
    // the run, and comes down faster, which is what ends it.
    const foot = FIELD.floor;
    const inZone = b.vy > 0 && b.y + BALL_R >= foot - 48 && b.y + BALL_R <= foot + 4 && Math.abs(b.x - m.x) <= 52;
    if (pad.pressed.a) {
      m.kick = 0.25;
      if (inZone) {
        const perfect = b.y + BALL_R >= foot - 16;
        m.score += perfect ? 2 : 1;
        if (perfect) m.perfect++;
        b.vy = -Math.min(720, 540 + m.score * 4);
        b.vx = (b.x - m.x) * 3 + (random() - 0.5) * 140;
        m.gravity = Math.min(900, m.gravity + 5);
        say('kick');
      }
    }
    if (b.y + BALL_R > foot + 4) { m.over = true; say('point'); }
  }

  function orchard(dt, pad) {
    const m = game.mini;
    if (m.over) { m.overFor += dt; if (m.overFor >= 1.0) finishGame(); return; }
    m.left -= dt;
    if (m.left <= 0) { m.left = 0; m.over = true; say('bell'); return; }
    let dx = 0;
    if (pad.left) dx -= 1;
    if (pad.right) dx += 1;
    m.x = clamp(m.x + dx * petSpeed() * dt, FIELD.left, FIELD.right);
    if (m.sour > 0) m.sour -= dt;

    m.spawnIn -= dt;
    if (m.spawnIn <= 0) {
      m.spawnIn = 0.45 + 0.5 * (m.left / 40);
      const roll = random();
      const kind = roll < 0.16 ? 'rotten' : roll < 0.28 ? 'golden' : 'apple';
      m.fruit.push({ x: FIELD.left + random() * (FIELD.right - FIELD.left), y: court.y + 60, vy: 130 + random() * 90 + (40 - m.left) * 2.5, kind });
    }

    const band = { top: FIELD.floor - 84, bottom: FIELD.floor - 30 };
    for (const f of m.fruit) {
      f.y += f.vy * dt;
      if (f.y >= band.top && f.y <= band.bottom && Math.abs(f.x - m.x) < 42) {
        f.gone = true;
        if (f.kind === 'rotten') { m.score = Math.max(0, m.score - 2); m.sour = 0.8; say('hurt'); }
        else { m.score += f.kind === 'golden' ? 3 : 1; m.caught++; say(f.kind === 'golden' ? 'coin' : 'munch'); }
      } else if (f.y > FIELD.floor) { f.gone = true; if (f.kind !== 'rotten') m.missed++; }
    }
    m.fruit = m.fruit.filter((f) => !f.gone);
  }

  function echo(dt, pad) {
    const m = game.mini;
    if (m.over) { m.overFor += dt; if (m.overFor >= 1.4) finishGame(); return; }
    if (m.flash) { m.flash.left -= dt; if (m.flash.left <= 0) m.flash = null; }
    m.timer -= dt;

    if (m.phase === 'show') {
      if (m.timer > 0) return;
      if (m.index >= m.seq.length) { m.phase = 'input'; m.index = 0; return; }
      const dir = m.seq[m.index++];
      m.flash = { dir, left: 0.35 };
      m.timer = 0.55;
      say(ECHO_SOUND[dir]);
      return;
    }
    if (m.phase === 'gap') {
      if (m.timer <= 0) { m.phase = 'show'; m.index = 0; m.timer = 0.4; }
      return;
    }

    const dir = DIRS.find((d) => pad.pressed[d]);
    if (!dir) return;
    m.flash = { dir, left: 0.3 };
    if (dir !== m.seq[m.index]) { m.wrong = dir; m.over = true; say('back'); return; }
    say(ECHO_SOUND[dir]);
    m.index++;
    if (m.index < m.seq.length) return;
    m.round++;
    m.score = m.round;
    if (m.round >= 20) { m.over = true; say('fanfare'); return; }
    m.seq.push(pick(random, DIRS));
    m.phase = 'gap';
    m.timer = 0.7;
    say('select');
  }

  function finishGame() {
    const m = game.mini;
    const r = REWARD[m.id];
    const bonus = byId(TEMPERS, pet.temper).bonus;
    const score = Math.max(0, m.score);
    const xp = Math.ceil((6 + score * r.xp) * bonus);
    const beans = Math.floor(score * r.beans);
    const joy = Math.min(30, Math.round(6 + score * r.joy));
    const key = `${m.id}Best`;
    const best = score > pet.counts[key];
    pet.counts.games++;
    pet.counts[key] = Math.max(pet.counts[key], score);
    pet.joy = Math.min(100, pet.joy + joy);
    pet.rest = Math.max(0, pet.rest - 10);
    pet.weight = Math.max(5, pet.weight - 2);
    pet.food = Math.max(0, pet.food - 3);
    pet.beans += beans;
    gainXp(xp);
    game.result = { id: m.id, score, xp, beans, joy, best, perfect: m.perfect ?? 0, round: m.round ?? 0, caught: m.caught ?? 0 };
    game.mini = null;
    say(best && score > 0 ? 'fanfare' : 'select');
    checkBadges();
    go('result');
    save();
  }

  // --- the step ----------------------------------------------------------------

  const LIVE = new Set(['home', 'paused', 'howto', 'care', 'play', 'juggle', 'orchard', 'echo', 'result', 'work', 'working', 'shop', 'almanac']);
  const CARDS = new Set(['home', 'care', 'play', 'work', 'shop']);
  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function moveCursor(frame, length) {
    if (length <= 0) return;
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }

  function toMenu() {
    pet = null;
    game.peek = peek();
    game.cards = [];
    game.note = null;
    go('menu');
  }
  game.peek = peek();

  const foodsUnlocked = () => FOODS.filter((f) => f.level <= pet.level);
  const playList = () => [...MINIGAMES.map((g) => ({ kind: 'game', item: g })), ...pet.toys.map((id) => ({ kind: 'toy', item: byId(TOYS, id) }))];
  const shopList = () => SHOP_TABS[game.tab][1];
  const almanacRows = () => (game.page === 0 ? [] : KINDS[game.page - 1][2]);

  function lights() {
    if (pet.asleep) care('wake');
    else if (pet.rest >= SLEEPY && !isNight()) note('NOT SLEEPY. TRY A GAME.');
    else care('tuck');
  }

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2);
    game.elapsed += dt;
    game.t += dt;
    if (game.note) { game.note.left -= dt; if (game.note.left <= 0) game.note = null; }

    if (pet && LIVE.has(game.screen)) {
      live(dt);
      if (!pet) return; // it died this frame; the dead screen takes over
    }

    // A card is modal: the world keeps turning under it, the pad goes to it.
    // Not in a minigame or a pastime -- a badge earned mid-rally waits until
    // the rally is over, or it would freeze the ball in the air.
    if (pet && game.cards.length && CARDS.has(game.screen)) {
      const top = game.cards[0];
      if (!top.shown) { top.shown = true; if (top.sound) say(top.sound); }
      if (game.elapsed > 0.3 && (confirmed(any) || any.pressed.b)) { game.cards.shift(); say('select'); }
      return;
    }

    switch (game.screen) {
      case 'menu': {
        moveCursor(any, MENU.length);
        if (!confirmed(any)) break;
        const choice = MENU[game.cursor].id;
        if (choice === 'quit') { say('select'); game.exit = true; break; }
        if (choice === 'howto') { say('select'); game.from = 'menu'; go('howto'); break; }
        if (choice === 'continue') {
          if (load()) { say('select'); if (game.screen !== 'dead') { game.icon = 0; go('home'); } }
          else { say('back'); note('NO TOMO SAVED YET. START ONE.'); }
          break;
        }
        say('select');
        game.draft = newDraft();
        go('create');
        break;
      }

      case 'create': {
        const d = game.draft;
        moveCursor(any, CREATE_ROWS.length);
        const row = CREATE_ROWS[game.cursor];
        const turn = (any.pressed.left ? -1 : 0) + (any.pressed.right ? 1 : 0);
        if (turn) {
          say('move');
          if (row === 'name') d.name = makeName(random);
          if (row === 'temper') d.temper = (d.temper + turn + TEMPERS.length) % TEMPERS.length;
          if (row === 'palate') d.palate = (d.palate + turn + PALATES.length) % PALATES.length;
          if (row === 'coat') d.coat = (d.coat + turn + COATS.length) % COATS.length;
        }
        if (any.pressed.b) { say('back'); toMenu(); break; }
        if (!confirmed(any)) break;
        if (row !== 'hatch') { game.cursor++; say('move'); break; }
        say('select');
        hatch();
        go('hatching');
        break;
      }

      case 'hatching': {
        // Wobble, crack, reveal. The sounds are keyed to elapsed so they land
        // on the frames the picture changes.
        const before = game.elapsed - dt;
        if (before < 1.6 && game.elapsed >= 1.6) say('crack');
        if (before < 2.4 && game.elapsed >= 2.4) say('hatch');
        if (game.elapsed >= 2.8 && (confirmed(any) || game.elapsed >= 8)) {
          const body = byId(ARCHETYPES, pet.look.archetype);
          card(`${pet.name} HATCHED`, [body.line, 'FEED IT. PLAY WITH IT. KEEP IT.']);
          game.icon = 0;
          go('home');
        }
        break;
      }

      case 'home': {
        if (any.pressed.left) { game.icon = (game.icon + HOME_ICONS.length - 1) % HOME_ICONS.length; say('move'); }
        if (any.pressed.right) { game.icon = (game.icon + 1) % HOME_ICONS.length; say('move'); }
        if (any.pressed.b) pat();
        if (any.pressed.select) lights();
        if (any.pressed.start) { say('select'); save(); go('paused'); break; }
        if (!any.pressed.a) break;
        say('select');
        switch (HOME_ICONS[game.icon].id) {
          case 'feed': game.tab = 0; go('care'); break;
          case 'care': game.tab = 1; go('care'); break;
          case 'play': go('play'); break;
          case 'work': go('work'); break;
          case 'shop': game.tab = 0; go('shop'); break;
          case 'book': game.page = 0; go('almanac'); break;
          default: break;
        }
        break;
      }

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('home'); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go('home');
        else if (choice === 'howto') { game.from = 'paused'; go('howto'); }
        else { save(); toMenu(); }
        break;
      }

      case 'howto':
        if (confirmed(any) || any.pressed.b) { say('back'); go(game.from); }
        break;

      case 'care': {
        const list = game.tab === 0 ? foodsUnlocked() : CARE;
        if (any.pressed.left || any.pressed.right) { game.tab = 1 - game.tab; game.cursor = 0; say('move'); }
        moveCursor(any, list.length);
        if (any.pressed.b) { say('back'); go('home'); break; }
        if (!confirmed(any)) break;
        if (game.tab === 0) feed(list[game.cursor]);
        else care(list[game.cursor].id);
        break;
      }

      case 'play': {
        const list = playList();
        moveCursor(any, list.length);
        if (any.pressed.b) { say('back'); go('home'); break; }
        if (!confirmed(any)) break;
        const { kind, item } = list[game.cursor];
        if (kind === 'game') startGame(item);
        else playToy(item);
        break;
      }

      case 'juggle': case 'orchard': case 'echo':
        if (any.pressed.b && !game.mini.over) { game.mini.over = true; game.mini.overFor = 99; }
        ({ juggle, orchard, echo })[game.screen](dt, any);
        break;

      case 'result':
        if (game.elapsed > 0.4 && (confirmed(any) || any.pressed.b)) { say('select'); go('home'); }
        break;

      case 'work': {
        moveCursor(any, ACTIVITIES.length);
        if (any.pressed.b) { say('back'); go('home'); break; }
        if (confirmed(any)) startWork(ACTIVITIES[game.cursor]);
        break;
      }

      case 'working':
        game.work.left -= dt;
        if (game.work.left <= 0) finishWork();
        break;

      case 'shop': {
        if (any.pressed.left) { game.tab = (game.tab + SHOP_TABS.length - 1) % SHOP_TABS.length; game.cursor = 0; say('move'); }
        if (any.pressed.right) { game.tab = (game.tab + 1) % SHOP_TABS.length; game.cursor = 0; say('move'); }
        moveCursor(any, shopList().length);
        if (any.pressed.b) { say('back'); go('home'); break; }
        if (confirmed(any)) buy(shopList()[game.cursor], ['food', 'toy', 'decor'][game.tab]);
        break;
      }

      case 'almanac': {
        if (any.pressed.left) { game.page = (game.page + KINDS.length) % (KINDS.length + 1); game.cursor = 0; say('move'); }
        if (any.pressed.right) { game.page = (game.page + 1) % (KINDS.length + 1); game.cursor = 0; say('move'); }
        moveCursor(any, almanacRows().length);
        if (any.pressed.b || any.pressed.start) { say('back'); go('home'); }
        break;
      }

      case 'dead':
        if (game.elapsed > 1 && (confirmed(any) || any.pressed.b)) { say('select'); toMenu(); }
        break;

      default:
        throw new Error(`unknown screen: ${game.screen}`);
    }
  }

  // --- drawing ---------------------------------------------------------------

  const text = (body, x, y, opts = {}) => ({
    text: body, x: Math.round(x), y: Math.round(y),
    scale: opts.scale ?? 2, anchor: opts.anchor ?? 'middle',
    fill: opts.fill ?? PALETTE.cream, font: opts.font ?? FONT,
  });
  const centred = (body, y, opts = {}) => {
    const font = opts.font ?? FONT;
    const scale = opts.scale ?? 2;
    return text(body, mid.x, y - (font.height * scale) / 2, { ...opts, font, scale });
  };
  const label = (body, x, y, opts = {}) => text(body, x, y, { anchor: 'start', ...opts });
  const coatFill = (coat) => PALETTE[byId(COATS, coat).fill];

  // A heart, from two discs and two tapering strokes. Nothing here is an ink
  // shape, so it can be as small as it likes.
  const heart = (hx, hy, r, fill) => [
    disc(hx - r * 0.5, hy - r * 0.3, r * 0.55, fill), disc(hx + r * 0.5, hy - r * 0.3, r * 0.55, fill),
    chain([{ x: hx - r * 0.85, y: hy - r * 0.1, r: r * 0.4 }, { x: hx, y: hy + r * 0.75, r: Math.max(2, r * 0.15) }], fill),
    chain([{ x: hx + r * 0.85, y: hy - r * 0.1, r: r * 0.4 }, { x: hx, y: hy + r * 0.75, r: Math.max(2, r * 0.15) }], fill),
  ];
  const ball = (bx, by, r) => [disc(bx, by, r, PALETTE.cream), disc(bx - r * 0.35, by - r * 0.2, r * 0.28, PALETTE.ink), disc(bx + r * 0.4, by + r * 0.3, r * 0.28, PALETTE.ink)];

  // The pet, as one inked layer's worth of shapes. `s` is the size; `look` is
  // the roll from hatching; everything else is how it feels right now.
  function petShapes({ cx, baseY, s, look, coat, mood = 'content', asleep = false, t = 0, sick = null, stage = 'adult', kick = 0, dead = false, sour = false, act = null, weight = 30 }) {
    const shapes = [];
    const fill = dead ? PALETTE.stone : coatFill(coat);
    const dim = dead ? PALETTE.stoneDim : PALETTE[`${coat}Dim`];
    const lit = dead ? PALETTE.stoneLit : PALETTE[`${coat}Lit`];
    const ink = PALETTE.ink;
    const R = 34 * s;
    const W = R * look.wide * (1 + (weight - 30) / 160);
    const H = R * look.tall;
    const body = look.archetype;
    const floating = body === 'wisp';
    const wob = sick === 'hiccups' && !asleep && !dead ? sway(t, 0.3, 3 * s) : 0;
    const bob = asleep || dead ? 0 : hop(t, mood === 'ecstatic' ? 0.5 : 1.1, (mood === 'ecstatic' ? 8 : 4) * s) + (floating ? sway(t, 2.5, 6 * s) + 8 * s : 0);
    const squash = asleep ? 1 : pulse(t, 2.6, 0.03);
    const x = cx + wob;
    const cy = baseY - H - bob;
    const headY = body === 'noodle' ? baseY - H * 2.3 - bob : cy;
    const hx = body === 'noodle' ? x - sway(t, 1.7, 5 * s) : x;
    const hy = headY;
    const hr = body === 'noodle' ? W * 0.68 : body === 'wisp' ? W * 0.9 : W;
    const legs = !floating && body !== 'noodle';

    // The body.
    switch (body) {
      case 'blob': shapes.push(disc(x, cy, W * squash, fill)); break;
      case 'box': shapes.push(rect(x - W, cy - H * squash, 2 * W, 2 * H * squash, fill)); break;
      case 'sprout': {
        const lean = sway(t, 2.2, 5 * s);
        shapes.push(disc(x, cy, W * 0.95 * squash, fill));
        shapes.push(chain([{ x, y: cy - H * 0.8, r: 3 * s }, { x: x + lean, y: cy - H * 1.35, r: 3 * s }], fill));
        shapes.push(disc(x + lean + 9 * s, cy - H * 1.42, 9 * s, PALETTE.leaf));
        shapes.push(disc(x + lean - 8 * s, cy - H * 1.3, 7 * s, PALETTE.leafLit));
        break;
      }
      case 'puff': {
        shapes.push(disc(x, cy, W * 0.78, fill));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + sway(t, 3, 0.05);
          shapes.push(disc(x + Math.cos(a) * W * 0.72, cy + Math.sin(a) * H * 0.72, W * 0.34 * squash, fill));
        }
        break;
      }
      case 'noodle':
        shapes.push(chain([
          { x, y: baseY - 8 * s, r: W * 0.55 },
          { x: x + sway(t, 1.7, 7 * s), y: cy, r: W * 0.6 },
          { x: hx, y: hy, r: hr },
        ], fill));
        break;
      case 'shell':
        shapes.push(disc(x - W * 0.3, cy - H * 0.35, W * 0.95, PALETTE.bark));
        shapes.push(disc(x - W * 0.3, cy - H * 0.35, W * 0.6, PALETTE.barkDim));
        shapes.push(disc(x - W * 0.3, cy - H * 0.35, W * 0.28, PALETTE.bark));
        shapes.push(disc(x + W * 0.15, cy + H * 0.1, W * 0.8 * squash, fill));
        break;
      case 'wisp':
        shapes.push(disc(x, cy, W * 0.9, fill));
        shapes.push(chain([{ x, y: cy + H * 0.3, r: W * 0.8 }, { x: x + sway(t, 1.5, 6 * s), y: baseY - H * 0.55 - bob + 8 * s, r: W * 0.45 }], fill));
        for (let i = -1; i <= 1; i++) shapes.push(disc(x + i * W * 0.42 + sway(t, 1.5, 4 * s), baseY - H * 0.5 - bob + 8 * s + sway(t, 0.9, 3 * s, i * 0.3), W * 0.26, fill));
        break;
      default: throw new Error(`unknown body: ${body}`);
    }

    if (legs) {
      shapes.push(disc(x - W * 0.45, baseY - 6 * s, 7 * s, fill));
      if (kick > 0) shapes.push(chain([{ x: x + W * 0.3, y: baseY - 10 * s, r: 6 * s }, { x: x + W * 0.95, y: baseY - 34 * s, r: 6 * s }], fill));
      else shapes.push(disc(x + W * 0.45, baseY - 6 * s, 7 * s, fill));
      // Arms. Up for a stretch, out for a hug, otherwise at its sides.
      const up = act === 'stretch' || mood === 'ecstatic';
      const ay = up ? cy - H * 1.1 : cy + H * 0.4 + sway(t, 1.3, 3 * s);
      shapes.push(chain([{ x: x - W * 0.85, y: cy, r: 5 * s }, { x: x - W * (up ? 1.1 : 1.05), y: ay, r: 5 * s }], fill));
      shapes.push(chain([{ x: x + W * 0.85, y: cy, r: 5 * s }, { x: x + W * (up ? 1.1 : 1.05), y: ay, r: 5 * s }], fill));
    }

    // Particulars: ears or an antenna, a tuft, spots.
    if (look.ears === 2) { shapes.push(disc(hx - hr * 0.62, hy - hr * 0.8, 9 * s, fill)); shapes.push(disc(hx + hr * 0.62, hy - hr * 0.8, 9 * s, fill)); }
    if (look.ears === 1) {
      const tip = sway(t, 2, 4 * s);
      shapes.push(chain([{ x: hx, y: hy - hr * 0.85, r: 3 * s }, { x: hx + tip, y: hy - hr * 1.45, r: 3 * s }], fill));
      shapes.push(disc(hx + tip, hy - hr * 1.5, 5 * s, lit));
    }
    if (look.tuft) shapes.push(disc(hx, hy - hr * 0.95, 6 * s, lit));
    const spotty = rng(look.spotSeed);
    for (let i = 0; i < look.spots; i++) shapes.push(disc(x + (spotty() - 0.5) * W * 1.1, cy + (spotty() - 0.3) * H * 0.9, 5 * s, dim));

    // The face.
    const fx = hx;
    const fy = hy - hr * look.eyeY;
    const er = Math.max(3, R * look.eyeR) * (mood === 'ecstatic' ? 1.15 : 1);
    const gap = hr * look.eyeGap;
    const blink = !asleep && !dead && (t % 4.3) < 0.12;
    const lidded = ['sleepy', 'poorly', 'miserable'].includes(mood);
    for (const ex of [fx - gap, fx + gap]) {
      if (dead) {
        shapes.push(chain([{ x: ex - 4 * s, y: fy - 4 * s, r: 2.5 * s }, { x: ex + 4 * s, y: fy + 4 * s, r: 2.5 * s }], ink));
        shapes.push(chain([{ x: ex + 4 * s, y: fy - 4 * s, r: 2.5 * s }, { x: ex - 4 * s, y: fy + 4 * s, r: 2.5 * s }], ink));
      } else if (asleep || blink) {
        shapes.push(rect(ex - er, fy - 2, 2 * er, 4, ink));
      } else {
        shapes.push(disc(ex, fy, er, ink));
        if (lidded) shapes.push(rect(ex - er - 1, fy - er - 1, 2 * er + 2, er + 1, fill));
        else if (er >= 4) shapes.push(disc(ex - er * 0.3, fy - er * 0.3, Math.max(1.5, er * 0.3), PALETTE.cream));
      }
    }
    if (look.cheeks && !dead) {
      const blush = coat === 'rose' ? PALETTE.roseLit : PALETTE.rose;
      shapes.push(disc(fx - gap - er - 5 * s, fy + 7 * s, 4 * s, blush));
      shapes.push(disc(fx + gap + er + 5 * s, fy + 7 * s, 4 * s, blush));
    }
    const my = fy + hr * 0.38;
    if (act === 'eat') {
      shapes.push(disc(fx, my, 3 * s + 2 * s * Math.abs(Math.sin(t * 12)), ink));
    } else if (dead || sour) {
      shapes.push(disc(fx, my, 3 * s, ink));
    } else if (asleep) {
      shapes.push(chain([{ x: fx - 3 * s, y: my, r: 2 * s }, { x: fx + 3 * s, y: my, r: 2 * s }], ink));
    } else if (mood === 'ecstatic') {
      shapes.push(disc(fx, my + 2 * s, 5 * s, ink));
      shapes.push(disc(fx, my + 4 * s, 2.5 * s, PALETTE.rose));
    } else if (mood === 'happy') {
      shapes.push(chain([{ x: fx - 7 * s, y: my - 2 * s, r: 2.2 * s }, { x: fx, y: my + 3 * s, r: 2.2 * s }, { x: fx + 7 * s, y: my - 2 * s, r: 2.2 * s }], ink));
    } else if (mood === 'content') {
      shapes.push(chain([{ x: fx - 4 * s, y: my, r: 2 * s }, { x: fx + 4 * s, y: my, r: 2 * s }], ink));
    } else if (mood === 'poorly' || mood === 'miserable') {
      shapes.push(chain([{ x: fx - 6 * s, y: my + 2 * s, r: 2 * s }, { x: fx - 2 * s, y: my, r: 2 * s }, { x: fx + 2 * s, y: my + 3 * s, r: 2 * s }, { x: fx + 6 * s, y: my, r: 2 * s }], ink));
    } else {
      shapes.push(chain([{ x: fx - 6 * s, y: my + 3 * s, r: 2 * s }, { x: fx, y: my, r: 2 * s }, { x: fx + 6 * s, y: my + 3 * s, r: 2 * s }], ink));
    }

    // Age shows.
    if (stage === 'teen') {
      shapes.push(rect(hx - 15 * s, hy - hr - 4 * s, 30 * s, 9 * s, PALETTE.sun));
      shapes.push(rect(hx + 4 * s, hy - hr + 1 * s, 22 * s, 5 * s, PALETTE.sunDim));
    }
    if (stage === 'elder') {
      shapes.push(disc(fx, my + 13 * s, 9 * s, coat === 'cream' ? PALETTE.creamDim : PALETTE.cream));
      if (legs) {
        shapes.push(chain([{ x: x + W * 0.95, y: baseY - 44 * s, r: 3 * s }, { x: x + W * 1.1, y: baseY - 2 * s, r: 3 * s }], PALETTE.bark));
        shapes.push(disc(x + W * 0.95 - 5 * s, baseY - 45 * s, 4 * s, PALETTE.bark));
      }
    }

    // Symptoms.
    if (sick === 'sniffles' && !dead) shapes.push(chain([{ x: fx + 3 * s, y: my - 5 * s, r: 2.5 * s }, { x: fx + 3 * s, y: my + 5 * s + hop(t, 1.2, 5 * s), r: 3.5 * s }], PALETTE.sky));
    if (sick === 'tummy' && !dead) shapes.push(disc(x, cy + H * 0.45, 8 * s, PALETTE.moss));
    if (sick === 'blues' && !dead) {
      const dx = sway(t, 3, 4 * s);
      shapes.push(disc(hx - 9 * s + dx, hy - hr - 18 * s, 6 * s, PALETTE.stone));
      shapes.push(disc(hx + dx, hy - hr - 22 * s, 8 * s, PALETTE.stone));
      shapes.push(disc(hx + 9 * s + dx, hy - hr - 18 * s, 6 * s, PALETTE.stone));
    }

    // What it is doing.
    if (act === 'bath') {
      for (let i = 0; i < 4; i++) shapes.push(disc(x + (i - 1.5) * W * 0.6, cy - 6 * s - hop(t, 0.7, 14 * s, i * 0.25), (4 + (i % 2) * 2) * s, i % 2 ? PALETTE.skyLit : PALETTE.sky));
    }
    if (act === 'hearts') {
      shapes.push(...heart(hx + hr + 10 * s, hy - hr - 6 * s - hop(t, 1, 16 * s), 7 * s, PALETTE.rose));
      shapes.push(...heart(hx - hr - 8 * s, hy - hr - hop(t, 1.3, 14 * s, 0.3), 5 * s, PALETTE.rose));
    }
    if (act === 'brush') {
      const by = hy - 12 * s + sway(t, 0.4, 9 * s);
      shapes.push(rect(hx + hr + 6 * s, by, 8 * s, 22 * s, PALETTE.bark));
      shapes.push(rect(hx + hr + 2 * s, by + 4 * s, 5 * s, 14 * s, PALETTE.cream));
    }
    if (act === 'heal') for (let i = 0; i < 3; i++) shapes.push(disc(hx + (i - 1) * hr * 0.9, hy - hr - 12 * s - hop(t, 0.8, 10 * s, i * 0.3), 4 * s, PALETTE.sun));
    if (act === 'toy') shapes.push(...ball(x + W * 1.5, baseY - 9 * s - hop(t, 0.6, 34 * s), 9 * s));
    if (act === 'eat') {
      shapes.push(rect(x - 16 * s, baseY - 9 * s, 32 * s, 8 * s, PALETTE.bark));
      shapes.push(disc(x, baseY - 11 * s, 8 * s, PALETTE.cream));
    }
    return shapes;
  }

  const stageScale = () => stageOf().scale;
  const liveSpec = (cx, baseY, extra = {}) => ({
    cx, baseY, s: stageScale(), look: pet.look, coat: pet.coat, mood: moodOf(), asleep: pet.asleep, t: game.t,
    sick: pet.sick, stage: stageOf().id, act: game.act?.kind ?? null, weight: pet.weight, ...extra,
  });

  // --- the room --------------------------------------------------------------

  const ROOM = { x: court.x + 212, y: court.y + 44, w: court.w - 220, h: 282 };
  const FLOOR_Y = ROOM.y + ROOM.h - 58;
  const PET_X = ROOM.x + ROOM.w * 0.42;
  const ROW0 = court.y + 122;
  const ROW_H = 34;
  const VISIBLE = 6;

  function windowShapes(night, kind) {
    const wx = ROOM.x + ROOM.w - 132;
    const wy = ROOM.y + 22;
    const glass = night ? PALETTE.violetDim : kind === 'sun' ? PALETTE.sky : kind === 'storm' ? PALETTE.violetDim : kind === 'snow' ? PALETTE.stoneLit : kind === 'rain' ? PALETTE.skyDim : PALETTE.stone;
    const shapes = [rect(wx - 5, wy - 5, 110, 86, PALETTE.cream), rect(wx, wy, 100, 76, glass)];
    const t = game.t;
    if (night) {
      shapes.push(disc(wx + 72, wy + 24, 12, PALETTE.cream));
      for (const [sx, sy] of [[18, 14], [34, 40], [12, 56]]) shapes.push(disc(wx + sx, wy + sy, 2.5, PALETTE.cream));
    } else if (kind === 'sun') {
      shapes.push(disc(wx + 76, wy + 22, 14, PALETTE.sun));
    } else if (kind === 'cloud' || kind === 'rain' || kind === 'storm') {
      const cx = wx + 30 + sway(t, 9, 8);
      const cloud = kind === 'storm' ? PALETTE.stoneDim : PALETTE.cream;
      shapes.push(disc(cx, wy + 20, 10, cloud), disc(cx + 14, wy + 16, 13, cloud), disc(cx + 28, wy + 21, 9, cloud));
      if (kind !== 'cloud') {
        for (let i = 0; i < 4; i++) {
          const ry = wy + 36 + ((t * 60 + i * 17) % 34);
          shapes.push(chain([{ x: wx + 14 + i * 22, y: ry, r: 2 }, { x: wx + 12 + i * 22, y: ry + 8, r: 2 }], PALETTE.skyLit));
        }
      }
      if (kind === 'storm' && (t % 3) < 0.25) shapes.push(chain([{ x: wx + 70, y: wy + 30, r: 2.5 }, { x: wx + 62, y: wy + 48, r: 2.5 }, { x: wx + 74, y: wy + 50, r: 2.5 }, { x: wx + 64, y: wy + 70, r: 2.5 }], PALETTE.sun));
    } else if (kind === 'snow') {
      for (let i = 0; i < 6; i++) shapes.push(disc(wx + 10 + i * 16 + sway(t, 2, 4, i * 0.2), wy + 6 + ((t * 18 + i * 13) % 64), 3, PALETTE.cream));
    }
    // Crossbars, drawn last so they sit over the weather.
    shapes.push(rect(wx + 48, wy, 4, 76, PALETTE.cream), rect(wx, wy + 36, 100, 4, PALETTE.cream));
    return shapes;
  }

  function decorShapes(night) {
    const shapes = [];
    const t = game.t;
    const has = (id) => pet.decor.includes(id);
    if (has('rug')) { shapes.push(rect(ROOM.x + 60, FLOOR_Y + 14, 200, 26, PALETTE.rose)); shapes.push(rect(ROOM.x + 76, FLOOR_Y + 22, 168, 10, PALETTE.roseDim)); }
    if (has('plant')) { shapes.push(rect(ROOM.x + 18, FLOOR_Y - 22, 24, 24, PALETTE.bark)); shapes.push(disc(ROOM.x + 30, FLOOR_Y - 34, 12, PALETTE.leaf), disc(ROOM.x + 20, FLOOR_Y - 42, 9, PALETTE.leafLit), disc(ROOM.x + 42, FLOOR_Y - 40, 8, PALETTE.leafDim)); }
    if (has('lamp')) { shapes.push(chain([{ x: ROOM.x + ROOM.w - 34, y: FLOOR_Y, r: 3 }, { x: ROOM.x + ROOM.w - 34, y: FLOOR_Y - 70, r: 3 }], PALETTE.bark)); shapes.push(disc(ROOM.x + ROOM.w - 34, FLOOR_Y - 78, 16, night ? PALETTE.sunLit : PALETTE.sun)); }
    if (has('poster')) { shapes.push(rect(ROOM.x + 40, ROOM.y + 30, 60, 76, PALETTE.cream)); shapes.push(disc(ROOM.x + 70, ROOM.y + 60, 16, PALETTE.rose), rect(ROOM.x + 50, ROOM.y + 86, 40, 6, PALETTE.ember)); }
    if (has('shelf')) {
      shapes.push(rect(ROOM.x + 120, ROOM.y + 40, 90, 6, PALETTE.bark), rect(ROOM.x + 120, ROOM.y + 80, 90, 6, PALETTE.bark));
      [PALETTE.ember, PALETTE.sky, PALETTE.moss, PALETTE.sun, PALETTE.violet].forEach((c, i) => shapes.push(rect(ROOM.x + 126 + i * 16, ROOM.y + 50 + (i % 2) * 4, 12, 30 - (i % 2) * 4, c)));
    }
    if (has('aquarium')) {
      shapes.push(rect(ROOM.x + 24, FLOOR_Y - 90, 80, 50, PALETTE.sky));
      const fx = ROOM.x + 44 + ((t * 22) % 44);
      shapes.push(disc(fx, FLOOR_Y - 66 + sway(t, 1.6, 4), 7, PALETTE.ember), chain([{ x: fx - 6, y: FLOOR_Y - 66, r: 2 }, { x: fx - 12, y: FLOOR_Y - 66 + sway(t, 0.5, 5), r: 4 }], PALETTE.ember));
      shapes.push(rect(ROOM.x + 24, FLOOR_Y - 92, 80, 4, PALETTE.bark));
    }
    if (has('radio')) { shapes.push(rect(ROOM.x + ROOM.w - 200, FLOOR_Y - 28, 44, 28, PALETTE.bark)); shapes.push(disc(ROOM.x + ROOM.w - 166, FLOOR_Y - 14, 6, PALETTE.sun), rect(ROOM.x + ROOM.w - 196, FLOOR_Y - 22, 18, 16, PALETTE.barkDim)); }
    if (has('clock')) {
      const cx = ROOM.x + ROOM.w - 60;
      const cy = ROOM.y + 126;
      shapes.push(disc(cx, cy, 20, PALETTE.cream));
      const h = ((pet.clock / HOUR) % 12) / 12 * Math.PI * 2;
      const m = ((pet.clock / MINUTE) % 60) / 60 * Math.PI * 2;
      shapes.push(chain([{ x: cx, y: cy, r: 2 }, { x: cx + Math.sin(h) * 9, y: cy - Math.cos(h) * 9, r: 2 }], PALETTE.bark));
      shapes.push(chain([{ x: cx, y: cy, r: 2 }, { x: cx + Math.sin(m) * 14, y: cy - Math.cos(m) * 14, r: 2 }], PALETTE.bark));
    }
    if (has('window')) {
      const wx = ROOM.x + ROOM.w - 132;
      shapes.push(rect(wx - 8, ROOM.y + 104, 116, 14, PALETTE.bark));
      [PALETTE.rose, PALETTE.sun, PALETTE.roseLit, PALETTE.sun, PALETTE.rose].forEach((c, i) => shapes.push(disc(wx + 8 + i * 24, ROOM.y + 100 + sway(t, 2, 2, i * 0.2), 6, c)));
    }
    if (has('bunk')) {
      shapes.push(rect(ROOM.x + 8, FLOOR_Y - 110, 8, 112, PALETTE.bark), rect(ROOM.x + 100, FLOOR_Y - 110, 8, 112, PALETTE.bark));
      shapes.push(rect(ROOM.x + 8, FLOOR_Y - 60, 100, 8, PALETTE.bark), rect(ROOM.x + 8, FLOOR_Y - 110, 100, 8, PALETTE.bark));
      shapes.push(rect(ROOM.x + 16, FLOOR_Y - 76, 84, 16, PALETTE.sky), rect(ROOM.x + 16, FLOOR_Y - 20, 84, 16, PALETTE.rose));
    }
    return shapes;
  }

  function messShapes() {
    const shapes = [];
    for (let i = 0; i < pet.messes; i++) {
      const mx = ROOM.x + ROOM.w - 90 - i * 50;
      const my = FLOOR_Y + 30;
      shapes.push(disc(mx, my - 8, 10, PALETTE.bark), disc(mx + 2, my - 19, 7, PALETTE.bark), disc(mx + 4, my - 27, 4, PALETTE.bark));
      const dy = hop(game.t, 1.4, 6, i * 0.3);
      shapes.push(chain([{ x: mx - 10, y: my - 40 - dy, r: 2 }, { x: mx - 14, y: my - 50 - dy, r: 2 }], PALETTE.barkDim));
      shapes.push(chain([{ x: mx + 12, y: my - 44 - dy, r: 2 }, { x: mx + 8, y: my - 54 - dy, r: 2 }], PALETTE.barkDim));
    }
    return shapes;
  }

  // Everything that lives in the room, in order: walls, furniture, the pet
  // and its mess, then the dark. Shared by the home and pause screens.
  function roomLayers() {
    const night = isNight();
    const kind = weather();
    const wall = night ? PALETTE.violetDim : kind === 'sun' ? PALETTE.sand : PALETTE.sandDim;
    const floor = night ? PALETTE.barkDim : PALETTE.bark;
    const layers = [{ flat: true, shapes: [
      rect(ROOM.x, ROOM.y, ROOM.w, ROOM.h, wall),
      rect(ROOM.x, FLOOR_Y, ROOM.w, ROOM.h - (FLOOR_Y - ROOM.y), floor),
      rect(ROOM.x, FLOOR_Y, ROOM.w, 4, PALETTE.barkLit),
      ...windowShapes(night, kind),
      ...decorShapes(night),
    ] }];
    layers.push({ ink: 5, shapes: [...messShapes(), ...petShapes(liveSpec(PET_X, FLOOR_Y + 30))] });
    if (game.dream && pet.asleep) {
      const name = byId(DREAMS, game.dream.id).name;
      const w = name.length * 16 + 24;
      const bx = PET_X + 40;
      const by = ROOM.y + 60;
      layers.push({ flat: true, shapes: [
        disc(PET_X + 30, FLOOR_Y - 40 * stageScale() - 30, 5, PALETTE.cream), disc(PET_X + 42, FLOOR_Y - 40 * stageScale() - 50, 8, PALETTE.cream),
        rect(bx, by, w, 36, PALETTE.cream), disc(bx, by + 18, 18, PALETTE.cream), disc(bx + w, by + 18, 18, PALETTE.cream),
      ] });
      layers.dreamText = text(name, bx + w / 2, by + 10, { fill: PALETTE.bark });
    }
    if (night || pet.asleep) layers.push({ flat: true, alpha: pet.decor.includes('lamp') ? 0.25 : 0.4, shapes: [rect(ROOM.x, ROOM.y, ROOM.w, ROOM.h, PALETTE.ink)] });
    return layers;
  }

  function bar(x, y, w, value, fill, name) {
    const v = clamp(value, 0, 100) / 100;
    return {
      shapes: [rect(x, y + 30, w, 10, PALETTE.barkDim), rect(x, y + 30, Math.max(2, w * v), 10, value < 25 ? PALETTE.ember : fill)],
      text: label(name, x, y, { fill: value < 25 ? PALETTE.ember : PALETTE.cream }),
    };
  }

  function hudParts() {
    const shapes = [];
    const labels = [];
    const stage = stageOf();
    const x = court.x + 12;
    labels.push(label(`${pet.name} · ${stage.name} · LV${pet.level}`, x, court.y + 6, { fill: coatFill(pet.coat) }));
    labels.push(text(clockText(pet.clock), court.x + court.w - 12, court.y + 6, { anchor: 'end' }));

    const bars = [['FOOD', pet.food, PALETTE.sun], ['JOY', pet.joy, PALETTE.rose], ['REST', pet.rest, PALETTE.sky], ['CLEAN', cleanOf(), PALETTE.moss], ['HEALTH', pet.health, PALETTE.ember]];
    bars.forEach(([name, value, fill], i) => {
      const b = bar(x, ROOM.y + i * 44, 180, value, fill, name);
      shapes.push(...b.shapes);
      labels.push(b.text);
    });
    // XP to the next level, then the purse and the mood. Age, weight and the
    // book's count live on the almanac's first page; there is no room here.
    const xy = ROOM.y + 5 * 44;
    shapes.push(rect(x, xy, 180, 6, PALETTE.barkDim), rect(x, xy, Math.max(2, 180 * pet.xp / xpFor(pet.level)), 6, PALETTE.violet));
    labels.push(label(`${pet.beans} BEANS`, x, xy + 14, { fill: PALETTE.sun }));
    labels.push(label(byId(MOODS, moodOf()).name, x, xy + 46, { fill: PALETTE.bark }));

    // The ring of things to do.
    HOME_ICONS.forEach((icon, i) => {
      const bx = court.x + 22 + i * 100;
      const by = court.y + court.h - 76;
      const on = i === game.icon;
      shapes.push(rect(bx, by, 92, 72, on ? coatFill(pet.coat) : PALETTE.barkDim));
      shapes.push(rect(bx + 3, by + 3, 86, 66, PALETTE.ink));
      shapes.push(...iconShapes(icon.id, bx + 46, by + 20));
      labels.push(text(icon.label, bx + 46, by + 36, { fill: on ? PALETTE.cream : PALETTE.bark }));
    });
    return { shapes, labels };
  }

  function iconShapes(id, cx, cy) {
    switch (id) {
      case 'feed': return [rect(cx - 14, cy, 28, 9, PALETTE.bark), disc(cx, cy - 2, 9, PALETTE.cream)];
      case 'play': return ball(cx, cy, 11);
      case 'care': return heart(cx, cy, 11, PALETTE.rose);
      case 'work': return [rect(cx - 5, cy - 11, 10, 5, PALETTE.barkDim), rect(cx - 13, cy - 7, 26, 18, PALETTE.bark), rect(cx - 2, cy - 2, 4, 5, PALETTE.sun)];
      case 'shop': return [disc(cx, cy, 11, PALETTE.sun), disc(cx, cy, 5, PALETTE.sunDim)];
      case 'book': return [rect(cx - 12, cy - 10, 24, 21, PALETTE.ember), rect(cx - 9, cy - 7, 18, 15, PALETTE.cream)];
      default: return [];
    }
  }

  // A card over whatever is showing, for anything the player must see.
  function cardParts() {
    const top = game.cards[0];
    if (!top) return { layers: [], text: [], box: null };
    const w = 620;
    const h = 104 + top.lines.length * 34;
    const x = mid.x - w / 2;
    const y = mid.y - h / 2;
    return {
      box: { y: y - 4, h: h + 8 },
      layers: [{ flat: true, shapes: [rect(x - 4, y - 4, w + 8, h + 8, PALETTE.sun), rect(x, y, w, h, PALETTE.ink)] }],
      text: [
        text(top.title, mid.x, y + 12, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
        ...top.lines.map((line, i) => text(line, mid.x, y + 52 + i * 34)),
        text('A', mid.x, y + h - 40, { fill: PALETTE.bark }),
      ],
    };
  }

  // Text draws after every layer, so a label under a card would print through
  // it. Drop the ones the card covers.
  const underCard = (labels, cards) => (cards.box ? labels.filter((l) => l.y + 32 <= cards.box.y || l.y >= cards.box.y + cards.box.h) : labels);

  const noteText = () => (game.note ? [centred(game.note.text, ROOM.y + ROOM.h + 20, { fill: PALETTE.sun })] : []);

  function homeScreen() {
    const room = roomLayers();
    const hud = hudParts();
    const labels = [...hud.labels, ...noteText()];
    if (room.dreamText) labels.push(room.dreamText);
    if (pet.asleep) labels.push(label('Z z', PET_X + 40 * stageScale() + 10, FLOOR_Y - 70 * stageScale() - hop(game.t, 2, 10), { fill: PALETTE.cream }));
    const cards = cardParts();
    return { layers: [...room, { flat: true, shapes: hud.shapes }, ...cards.layers], text: [...underCard(labels, cards), ...cards.text] };
  }

  function pausedScreen() {
    const room = roomLayers().map((layer) => ({ ...layer, alpha: 0.25 }));
    return {
      layers: room,
      text: [
        centred('PAUSED', court.y + 90, { font: HEAVY, scale: 2, fill: PALETTE.sun }),
        ...PAUSE_MENU.map((entry, i) => centred(`${i === game.cursor ? '▶ ' : '  '}${entry.label}`, court.y + 200 + i * 40, { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
        centred('IT KEEPS LIVING WHILE YOU ARE AWAY', court.y + court.h - 24, { fill: PALETTE.bark }),
      ],
    };
  }

  // --- the other screens -----------------------------------------------------

  const MENU_LOOK = { archetype: 'blob', eyeGap: 0.42, eyeR: 0.13, eyeY: 0.1, ears: 2, wide: 1.05, tall: 1, spots: 0, spotSeed: 1, cheeks: true, tuft: true };

  function menuScreen() {
    const shapes = petShapes({ cx: court.x + 130, baseY: court.y + 300, s: 1.2, look: MENU_LOOK, coat: 'rose', mood: 'happy', t: game.t });
    const labels = [
      text('TOMO', court.x + 280, court.y + 50, { font: HEAVY, scale: 3, fill: PALETTE.rose, anchor: 'start' }),
      label('A FRIEND IN THE MACHINE', court.x + 280, court.y + 156, { fill: PALETTE.bark }),
      ...MENU.map((entry, i) => label(`${i === game.cursor ? '▶ ' : '  '}${entry.label}`, court.x + 280, court.y + 204 + i * 40, { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
    ];
    if (game.peek) labels.push(label(`${game.peek.name} · ${spanText(game.peek.age)} OLD · LV${game.peek.level}`, court.x + 280, court.y + 370, { fill: PALETTE.moss }));
    else labels.push(label('NOBODY SAVED YET', court.x + 280, court.y + 370, { fill: PALETTE.barkDim }));
    if (memorial.length) {
      const last = memorial[memorial.length - 1];
      labels.push(label(`REMEMBERING ${last.name} · ${last.days}D`, court.x + 280, court.y + 404, { fill: PALETTE.bark }));
    }
    labels.push(label('START OR A TO CHOOSE', court.x + 24, court.y + 404, { fill: PALETTE.barkDim }));
    return { layers: [{ ink: 5, shapes }], text: labels };
  }

  function eggShapes(cx, cy, coat, freckles, wobble, cracked) {
    const fill = coatFill(coat);
    const shapes = [chain([{ x: cx + wobble, y: cy - 40, r: 44 }, { x: cx, y: cy + 30, r: 52 }], PALETTE.cream)];
    freckles.forEach(([fx, fy]) => shapes.push(disc(cx + fx * 30 + wobble * (fy < 0 ? 1 : 0.3), cy + fy * 40, 6, fill)));
    if (cracked) shapes.push(chain([{ x: cx - 30, y: cy - 4, r: 2.5 }, { x: cx - 12, y: cy + 8, r: 2.5 }, { x: cx + 2, y: cy - 8, r: 2.5 }, { x: cx + 18, y: cy + 6, r: 2.5 }, { x: cx + 34, y: cy - 2, r: 2.5 }], PALETTE.ink));
    return shapes;
  }

  function createScreen() {
    const d = game.draft;
    const wobble = sway(game.t, 1.8, 4);
    const shapes = eggShapes(court.x + 150, court.y + 250, COATS[d.coat].id, d.freckles, wobble, false);
    const rows = [
      ['NAME', d.name], ['TEMPER', TEMPERS[d.temper].name], ['PALATE', PALATES[d.palate].name], ['COAT', COATS[d.coat].name], ['HATCH', ''],
    ];
    const labels = [
      centred('A NEW TOMO', court.y + 56, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
      ...rows.map(([name, value], i) => {
        const on = i === game.cursor;
        const y = court.y + 110 + i * 44;
        const out = [label(`${on ? '▶ ' : '  '}${name}`, court.x + 300, y, { fill: on ? PALETTE.sun : PALETTE.cream })];
        if (value) out.push(label(`${on ? '◀ ' : '  '}${value}${on ? ' ▶' : ''}`, court.x + 440, y, { fill: on ? PALETTE.cream : PALETTE.bark }));
        return out;
      }).flat(),
    ];
    const lines = { name: 'LEFT OR RIGHT ROLLS ANOTHER NAME', temper: TEMPERS[d.temper].line, palate: PALATES[d.palate].line, coat: 'THE BODY IS A SURPRISE', hatch: 'A TO HATCH IT' };
    labels.push(centred(lines[CREATE_ROWS[game.cursor]], court.y + court.h - 80, { fill: PALETTE.moss }));
    if (game.peek) labels.push(centred(`THIS RETIRES ${game.peek.name}`, court.y + court.h - 48, { fill: PALETTE.ember }));
    labels.push(centred('A NEXT · B BACK', court.y + court.h - 16, { fill: PALETTE.barkDim }));
    return { layers: [{ ink: 5, shapes }], text: labels };
  }

  function hatchingScreen() {
    const e = game.elapsed;
    const labels = [];
    let shapes;
    if (e < 2.4) {
      const wobble = sway(game.t, 0.5, 4 + e * 6);
      shapes = eggShapes(mid.x, court.y + 240, pet.coat, game.draft.freckles, wobble, e >= 1.6);
      labels.push(centred(e < 1.6 ? 'SOMETHING IS HAPPENING' : 'CRACK', court.y + court.h - 60, { fill: PALETTE.sun }));
    } else {
      const body = byId(ARCHETYPES, pet.look.archetype);
      shapes = petShapes(liveSpec(mid.x, court.y + 300, { mood: 'ecstatic', act: null }));
      labels.push(centred(`${pet.name} IS A ${body.name}!`, court.y + 60, { font: HEAVY, scale: 1, fill: PALETTE.sun }));
      labels.push(centred(body.line, court.y + court.h - 80, { fill: PALETTE.cream }));
      if (e >= 2.8) labels.push(centred('A TO SAY HELLO', court.y + court.h - 40, { fill: PALETTE.bark }));
    }
    return { layers: [{ ink: 5, shapes }], text: labels };
  }

  function howtoScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(mid.x - 200, court.y + 84, 400, 4, PALETTE.bark)] }],
      text: [
        centred('HOW TO PLAY', court.y + 50, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => centred(line, court.y + 116 + i * 34)),
        centred('A OR B TO GO BACK', court.y + court.h - 16, { fill: PALETTE.bark }),
      ],
    };
  }

  // A scrolling list: `visible` rows around the cursor, each with the slot it
  // draws in. Text at scale 2 is 32 px tall, so rows are ROW_H apart.
  function listRows(items, cursor, visible = VISIBLE) {
    const top = clamp(cursor - Math.floor(visible / 2), 0, Math.max(0, items.length - visible));
    return items.slice(top, top + visible).map((item, i) => ({ item, index: top + i, slot: i, selected: top + i === cursor }));
  }
  const rowY = (slot) => ROW0 + slot * ROW_H;
  const heading = (title) => centred(title, court.y + 50, { font: HEAVY, scale: 1, fill: PALETTE.sun });
  const hint = (body) => centred(body, court.y + court.h - 16, { fill: PALETTE.barkDim });
  const statLine = () => centred(`FOOD ${Math.round(pet.food)}  JOY ${Math.round(pet.joy)}  REST ${Math.round(pet.rest)}  HP ${Math.round(pet.health)}`, court.y + court.h - 48, { fill: PALETTE.bark });
  // The line under a list: the note if there is one, else what the cursor is on.
  const underline = (line) => centred(game.note ? game.note.text : line ?? '', court.y + court.h - 80, { fill: game.note ? PALETTE.sun : PALETTE.moss });

  function sidePet(extra = {}) {
    return { ink: 5, shapes: petShapes(liveSpec(court.x + 110, court.y + 300, extra)) };
  }

  function careScreen() {
    const foods = foodsUnlocked();
    const colX = [court.x + 220, court.x + 460];
    const labels = [heading('PANTRY AND CARE')];
    labels.push(label('FOOD', colX[0], court.y + 84, { fill: game.tab === 0 ? PALETTE.sun : PALETTE.bark }));
    labels.push(label('CARE', colX[1], court.y + 84, { fill: game.tab === 1 ? PALETTE.sun : PALETTE.bark }));
    for (const row of listRows(foods, game.tab === 0 ? game.cursor : 0)) {
      const f = row.item;
      const have = f.cost === 0 ? '' : ` x${pet.pantry[f.id] ?? 0}`;
      const on = game.tab === 0 && row.selected;
      const fill = on ? PALETTE.sun : f.cost === 0 || pet.pantry[f.id] > 0 ? PALETTE.cream : PALETTE.bark;
      labels.push(label(`${on ? '▶' : ' '}${f.name}${have}`, colX[0], rowY(row.slot), { fill }));
    }
    for (const row of listRows(CARE, game.tab === 1 ? game.cursor : 0)) {
      const on = game.tab === 1 && row.selected;
      labels.push(label(`${on ? '▶' : ' '}${row.item.name}`, colX[1], rowY(row.slot), { fill: on ? PALETTE.sun : PALETTE.cream }));
    }
    const chosen = game.tab === 0 ? foods[game.cursor] : CARE[game.cursor];
    labels.push(underline(chosen?.line), statLine(), hint('A DOES IT · LEFT RIGHT SWITCH · B BACK'));
    const cards = cardParts();
    return { layers: [sidePet(), { flat: true, shapes: [rect(court.x + 446, court.y + 90, 3, 260, PALETTE.barkDim)] }, ...cards.layers], text: [...underCard(labels, cards), ...cards.text] };
  }

  function playScreen() {
    const list = playList();
    const labels = [heading('PLAY')];
    for (const row of listRows(list, game.cursor)) {
      const { kind, item } = row.item;
      const best = kind === 'game' ? `BEST ${pet.counts[`${item.id}Best`]}` : `JOY +${item.joy}`;
      labels.push(label(`${row.selected ? '▶ ' : '  '}${item.name}`, court.x + 240, rowY(row.slot), { fill: row.selected ? PALETTE.sun : PALETTE.cream }));
      labels.push(text(best, court.x + court.w - 30, rowY(row.slot), { anchor: 'end', fill: PALETTE.bark }));
    }
    labels.push(underline(list[game.cursor]?.item.line), statLine(), hint('A PLAYS · B BACK'));
    const cards = cardParts();
    return { layers: [sidePet(), ...cards.layers], text: [...underCard(labels, cards), ...cards.text] };
  }

  function workScreen() {
    const labels = [heading('PASTIMES')];
    for (const row of listRows(ACTIVITIES, game.cursor)) {
      const a = row.item;
      const open = pet.level >= a.level;
      const fill = row.selected ? PALETTE.sun : open ? PALETTE.cream : PALETTE.barkDim;
      const name = open || row.selected ? (a.short ?? a.name) : '????';
      labels.push(label(`${row.selected ? '▶' : ' '}${name}`, court.x + 232, rowY(row.slot), { fill }));
      labels.push(text(open ? `x${pet.counts.did[a.id] ?? 0}` : `LV${a.level}`, court.x + court.w - 24, rowY(row.slot), { anchor: 'end', fill: open ? PALETTE.bark : PALETTE.barkDim }));
    }
    const a = ACTIVITIES[game.cursor];
    labels.push(underline(pet.level >= a.level ? `${a.secs}S · REST -${a.rest} · +${a.xp} XP · +${a.beans} BEANS` : `UNLOCKS AT LEVEL ${a.level}`));
    labels.push(statLine(), hint('A STARTS · B BACK'));
    const cards = cardParts();
    return { layers: [sidePet(), ...cards.layers], text: [...underCard(labels, cards), ...cards.text] };
  }

  function workingScreen() {
    const a = byId(ACTIVITIES, game.work.id);
    const done = 1 - game.work.left / game.work.total;
    const t = game.t;
    const props = [];
    const px = mid.x + 110;
    const py = court.y + 300;
    switch (a.id) {
      case 'programming':
        props.push(rect(px - 50, py - 90, 100, 70, PALETTE.stoneDim), rect(px - 44, py - 84, 88, 58, PALETTE.ink), rect(px - 10, py - 20, 20, 20, PALETTE.stoneDim));
        for (let i = 0; i < 4; i++) props.push(rect(px - 38, py - 78 + i * 13, 20 + ((i * 37 + Math.floor(t * 3)) % 50), 6, i % 2 ? PALETTE.moss : PALETTE.sky));
        break;
      case 'science':
        props.push(chain([{ x: px, y: py - 90, r: 8 }, { x: px, y: py - 50, r: 8 }, { x: px, y: py - 10, r: 30 }], PALETTE.sky));
        props.push(disc(px, py - 4, 24, PALETTE.moss));
        for (let i = 0; i < 3; i++) props.push(disc(px - 10 + i * 10, py - 30 - hop(t, 0.9, 40, i * 0.33), 4, PALETTE.mossLit));
        break;
      case 'stars':
        props.push(disc(px, py - 80, 22, PALETTE.cream));
        for (const [sx, sy] of [[-60, -110], [40, -130], [70, -70], [-30, -40]]) props.push(disc(px + sx, py + sy, 3 + ((t + sx) % 1), PALETTE.sun));
        break;
      case 'baking':
        props.push(rect(px - 40, py - 20, 80, 24, PALETTE.bark), disc(px, py - 24, 26, PALETTE.cream), disc(px, py - 30, 16, PALETTE.sunDim));
        break;
      default:
        for (let i = 0; i < 5; i++) {
          const a2 = t * 1.2 + (i / 5) * Math.PI * 2;
          props.push(disc(px + Math.cos(a2) * 50, py - 60 + Math.sin(a2) * 30, 5, i % 2 ? PALETTE.sun : PALETTE.sunLit));
        }
    }
    const barW = 400;
    return {
      layers: [
        { flat: true, shapes: props },
        { ink: 5, shapes: petShapes(liveSpec(mid.x - 60, court.y + 320, { mood: 'happy', act: null })) },
        { flat: true, shapes: [rect(mid.x - barW / 2, court.y + court.h - 60, barW, 14, PALETTE.barkDim), rect(mid.x - barW / 2, court.y + court.h - 60, Math.max(3, barW * done), 14, PALETTE.sun)] },
      ],
      text: [
        heading(a.name),
        centred(`${Math.ceil(game.work.left)}`, court.y + court.h - 90, { fill: PALETTE.bark }),
      ],
    };
  }

  function shopScreen() {
    const labels = [heading('SHOP'), text(`${pet.beans} BEANS`, court.x + court.w - 24, court.y + 34, { anchor: 'end', fill: PALETTE.sun })];
    SHOP_TABS.forEach(([name], i) => labels.push(text(name, mid.x + (i - 1) * 140, court.y + 84, { fill: i === game.tab ? PALETTE.sun : PALETTE.bark })));
    const kind = ['food', 'toy', 'decor'][game.tab];
    for (const row of listRows(shopList(), game.cursor)) {
      const item = row.item;
      const locked = kind === 'food' && pet.level < item.level;
      const owned = kind === 'toy' ? pet.toys.includes(item.id) : kind === 'decor' ? pet.decor.includes(item.id) : false;
      const fill = row.selected ? PALETTE.sun : locked ? PALETTE.barkDim : PALETTE.cream;
      labels.push(label(`${row.selected ? '▶ ' : '  '}${locked ? '????' : item.name}`, court.x + 80, rowY(row.slot), { fill }));
      const right = locked ? `LV${item.level}` : owned ? 'OWNED' : kind === 'food' ? `${item.cost} BEANS  x${pet.pantry[item.id] ?? 0}` : `${item.cost} BEANS`;
      labels.push(text(right, court.x + court.w - 80, rowY(row.slot), { anchor: 'end', fill: PALETTE.bark }));
    }
    const chosen = shopList()[game.cursor];
    labels.push(underline(chosen && !(kind === 'food' && pet.level < chosen.level) ? chosen.line : 'NOT YET'));
    labels.push(statLine(), hint('A BUYS · LEFT RIGHT SHELF · B BACK'));
    const cards = cardParts();
    return { layers: [{ flat: true, shapes: [rect(mid.x - 240, court.y + 112, 480, 3, PALETTE.barkDim)] }, ...cards.layers], text: [...underCard(labels, cards), ...cards.text] };
  }

  function almanacScreen() {
    const labels = [];
    const seen = seenCount(pet);
    const pages = KINDS.length + 1;
    if (game.page === 0) {
      labels.push(heading(`THE BOOK OF ${pet.name}`));
      const rows = [
        `A ${byId(TEMPERS, pet.temper).name} ${byId(ARCHETYPES, pet.look.archetype).name} · ${byId(COATS, pet.coat).name} · ${byId(PALATES, pet.palate).name}`,
        `${stageOf().name} · AGE ${spanText(pet.age)} · WEIGHT ${Math.round(pet.weight)}`,
        `LEVEL ${pet.level} · ${pet.xp}/${xpFor(pet.level)} XP · ${pet.beans} BEANS`,
        `BEST JUGGLE ${pet.counts.juggleBest} · ORCHARD ${pet.counts.orchardBest} · ECHO ${pet.counts.echoBest}`,
        `${pet.badges.length}/${BADGES.length} BADGES · ${seen}/${FACETS.length} SEEN`,
        `STREAK ${pet.counts.streak} · VISITORS ${pet.counts.visits} · SCIENCE ${pet.counts.science}%`,
        memorial.length ? `BEFORE: ${memorial.slice(-3).map((m) => `${m.name} ${m.days}D`).join(', ')}` : 'THE FIRST OF ITS LINE',
      ];
      rows.forEach((row, i) => labels.push(label(row, court.x + 24, court.y + 92 + i * 36, { fill: i === rows.length - 1 ? PALETTE.bark : PALETTE.cream })));
    } else {
      const [kind, title, list] = KINDS[game.page - 1];
      const met = list.filter((item) => pet.seen[`${kind}:${item.id}`]).length;
      labels.push(heading(`${title}  ${met}/${list.length}`));
      for (const row of listRows(list, game.cursor)) {
        const known = pet.seen[`${kind}:${row.item.id}`];
        const y = court.y + 92 + row.slot * ROW_H;
        labels.push(label(`${row.selected ? '▶ ' : '  '}${known ? row.item.name : '????'}`, court.x + 40, y, { fill: row.selected ? PALETTE.sun : known ? PALETTE.cream : PALETTE.barkDim }));
        if (kind === 'activity' && !known) labels.push(text(`LV${row.item.level}`, court.x + court.w - 40, y, { anchor: 'end', fill: PALETTE.barkDim }));
      }
      const chosen = list[game.cursor];
      const known = chosen && pet.seen[`${kind}:${chosen.id}`];
      labels.push(centred(known ? lineOf(chosen) : kind === 'badge' ? chosen.hint : 'NOT MET YET', court.y + court.h - 64, { fill: known ? PALETTE.moss : PALETTE.barkDim }));
    }
    labels.push(hint(`◀ ${game.page + 1}/${pages} ▶ · B BACK`));
    return { layers: [{ flat: true, shapes: [rect(mid.x - 260, court.y + 78, 520, 3, PALETTE.barkDim)] }], text: labels };
  }

  function resultScreen() {
    const r = game.result;
    const spec = byId(MINIGAMES, r.id);
    const what = r.id === 'juggle' ? `${r.score} JUGGLES` : r.id === 'orchard' ? `${r.score} POINTS` : `${r.score} ROUNDS`;
    return {
      layers: [{ ink: 5, shapes: petShapes(liveSpec(mid.x, court.y + 340, { mood: r.score > 0 ? 'ecstatic' : 'bored', act: null })) }],
      text: [
        heading(spec.name),
        centred(what, court.y + 112, { font: HEAVY, scale: 1 }),
        centred(r.best && r.score > 0 ? 'NEW BEST' : r.perfect ? `${r.perfect} PERFECT` : '', court.y + 156, { fill: PALETTE.moss }),
        centred(`+${r.xp} XP · +${r.beans} BEANS · JOY +${r.joy}`, court.y + 196, { fill: PALETTE.cream }),
        hint('A'),
      ],
    };
  }

  const fieldLayers = (sky, ground) => [{ flat: true, shapes: [
    rect(court.x, court.y, court.w, court.h, sky),
    rect(court.x, FIELD.floor, court.w, court.h - (FIELD.floor - court.y), ground),
  ] }];

  function juggleScreen() {
    const m = game.mini;
    const b = m.ball;
    const height = clamp((FIELD.floor - b.y) / 300, 0, 1);
    const layers = fieldLayers(PALETTE.sky, PALETTE.turf);
    layers[0].shapes.push(rect(court.x + court.w - 120, FIELD.floor - 120, 8, 120, PALETTE.cream), rect(court.x + court.w - 40, FIELD.floor - 120, 8, 120, PALETTE.cream), rect(court.x + court.w - 120, FIELD.floor - 124, 88, 8, PALETTE.cream));
    layers[0].shapes.push(rect(court.x, FIELD.floor, court.w, 4, PALETTE.turfLit));
    layers[0].shapes.push(disc(b.x, FIELD.floor + 6, 12 - height * 6, PALETTE.turfDim));
    layers.push({ ink: 5, shapes: [...petShapes(liveSpec(m.x, FIELD.floor, { kick: m.kick, act: null, mood: m.over ? 'bored' : 'happy' })), ...ball(b.x, b.y, BALL_R)] });
    return {
      layers,
      text: [
        centred(String(m.score), court.y + 30, { font: HEAVY, scale: 2, fill: PALETTE.cream }),
        ...(m.over ? [centred('DROPPED', court.y + 130, { fill: PALETTE.ember })] : game.elapsed < 2 ? [centred('A KICKS WHEN IT IS LOW', court.y + 130, { fill: PALETTE.cream })] : []),
      ],
    };
  }

  function orchardScreen() {
    const m = game.mini;
    const layers = fieldLayers(PALETTE.skyLit, PALETTE.moss);
    const bg = layers[0].shapes;
    bg.push(rect(mid.x - 24, court.y, 48, 90, PALETTE.bark));
    for (let i = 0; i < 9; i++) bg.push(disc(court.x + 40 + i * 70 + sway(game.t, 3, 4, i * 0.1), court.y + 20 + (i % 2) * 18, 44, i % 3 ? PALETTE.leaf : PALETTE.leafLit));
    const fruit = [];
    for (const f of m.fruit) {
      if (f.kind === 'golden') fruit.push(disc(f.x, f.y, 10, PALETTE.sun), disc(f.x - 3, f.y - 3, 3, PALETTE.sunLit));
      else if (f.kind === 'rotten') fruit.push(disc(f.x, f.y, 9, PALETTE.barkDim), disc(f.x + 3, f.y - 2, 3, PALETTE.moss));
      else fruit.push(disc(f.x, f.y, 9, PALETTE.ember), disc(f.x + 4, f.y - 9, 3.5, PALETTE.leaf));
    }
    layers.push({ ink: 4, shapes: [...petShapes(liveSpec(m.x, FIELD.floor, { act: null, sour: m.sour > 0, mood: m.over ? 'happy' : 'content' })), ...fruit] });
    const secs = Math.ceil(m.left);
    return {
      layers,
      text: [
        label(String(m.score), court.x + 24, court.y + 100, { font: HEAVY, scale: 1, fill: PALETTE.cream }),
        text(`0:${String(secs).padStart(2, '0')}`, court.x + court.w - 24, court.y + 100, { anchor: 'end', font: HEAVY, scale: 1, fill: secs <= 5 ? PALETTE.ember : PALETTE.cream }),
        ...(m.over ? [centred('TIME', court.y + 150, { font: HEAVY, scale: 1, fill: PALETTE.sun })] : []),
      ],
    };
  }

  function echoScreen() {
    const m = game.mini;
    const cx = mid.x;
    const cy = court.y + 236;
    const pads = { up: [cx, cy - 120, 'sun'], right: [cx + 190, cy, 'rose'], down: [cx, cy + 120, 'sky'], left: [cx - 190, cy, 'moss'] };
    const shapes = [];
    for (const [dir, [px, py, colour]] of Object.entries(pads)) {
      const lit = m.flash?.dir === dir;
      shapes.push(disc(px, py, lit ? 40 : 34, PALETTE[lit ? `${colour}Lit` : colour]));
      if (m.wrong === dir) shapes.push(disc(px, py, 14, PALETTE.ember));
    }
    const hint = m.over ? (m.round >= 20 ? 'PERFECT' : 'WRONG') : m.phase === 'input' ? 'YOUR TURN' : 'WATCH';
    return {
      layers: [
        { flat: true, shapes },
        { ink: 5, shapes: petShapes(liveSpec(cx, cy + 50, { act: null, mood: m.over && m.round < 20 ? 'bored' : 'happy' })) },
      ],
      text: [
        centred(`ROUND ${m.round + 1}`, court.y + 34, { font: HEAVY, scale: 1, fill: PALETTE.cream }),
        centred(hint, court.y + court.h - 40, { fill: m.over && m.round < 20 ? PALETTE.ember : PALETTE.sun }),
      ],
    };
  }

  function deadScreen() {
    const f = game.fallen;
    return {
      layers: [{ ink: 5, shapes: petShapes({ cx: mid.x, baseY: court.y + 300, s: 1, look: f.look, coat: f.coat, dead: true, t: 0 }) }],
      text: [
        centred(`${f.name} HAS GONE`, court.y + 52, { font: HEAVY, scale: 1, fill: PALETTE.ember }),
        centred(EPITAPHS[f.cause] ?? EPITAPHS.poorly, court.y + 100, { fill: PALETTE.cream }),
        centred(`${spanText(f.age)} OLD · LEVEL ${f.level} · ${f.seen}/${FACETS.length} SEEN`, court.y + court.h - 84, { fill: PALETTE.bark }),
        centred('IT WILL BE REMEMBERED ON THE MENU', court.y + court.h - 50, { fill: PALETTE.bark }),
        centred('A', court.y + court.h - 16, { fill: PALETTE.barkDim }),
      ],
    };
  }

  const SCREENS = {
    menu: menuScreen, create: createScreen, hatching: hatchingScreen, howto: howtoScreen,
    home: homeScreen, paused: pausedScreen, care: careScreen, play: playScreen,
    juggle: juggleScreen, orchard: orchardScreen, echo: echoScreen, result: resultScreen,
    work: workScreen, working: workingScreen, shop: shopScreen, almanac: almanacScreen, dead: deadScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Tomo (${game.screen})`,
      width,
      height,
      background: PALETTE.ink,
      matte: court,
      matteColour: PALETTE.ink,
      font: FONT,
      layers,
      text: labels,
    };
  }

  const TRACK = {
    menu: 'tomo', howto: 'tomo', dead: 'tomo', create: 'hatch', hatching: 'hatch',
    home: 'nook', paused: 'nook', shop: 'nook', almanac: 'nook', result: 'nook',
    care: 'pantry', play: 'juggle', juggle: 'juggle', orchard: 'orchard', echo: 'echo', work: 'study', working: 'study',
  };

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    music() { return game.screen === 'howto' && game.from !== 'menu' ? 'nook' : TRACK[game.screen]; },
    state() {
      return {
        screen: game.screen, exit: game.exit, cursor: game.cursor, icon: game.icon, tab: game.tab, page: game.page,
        elapsed: game.elapsed, saves: game.saves, cards: game.cards.length, note: game.note?.text ?? null,
        draft: game.draft ? { ...game.draft } : null,
        mini: game.mini ? JSON.parse(JSON.stringify(game.mini)) : null,
        result: game.result ? { ...game.result } : null,
        work: game.work ? { ...game.work } : null,
        fallen: game.fallen ? { name: game.fallen.name, days: game.fallen.days, cause: game.fallen.cause } : null,
        pet: pet ? {
          name: pet.name, body: pet.look.archetype, temper: pet.temper, palate: pet.palate, coat: pet.coat,
          food: pet.food, joy: pet.joy, rest: pet.rest, clean: cleanOf(), health: pet.health, weight: pet.weight,
          asleep: pet.asleep, messes: pet.messes, sick: pet.sick, xp: pet.xp, level: pet.level, beans: pet.beans,
          age: pet.age, clock: pet.clock, date: { ...pet.date }, stage: stageOf().id, mood: moodOf(), weather: weather(),
          seen: seenCount(pet), badges: [...pet.badges], toys: [...pet.toys], decor: [...pet.decor], pantry: { ...pet.pantry },
          counts: JSON.parse(JSON.stringify(pet.counts)),
        } : null,
      };
    },
    court,
  };
}

// A blob with a bounce, for the shelf.
function emblem({ x, y, w, h }) {
  const cx = x + w / 2;
  const cy = y + h * 0.5;
  const r = Math.min(w, h) * 0.3;
  return [
    disc(cx, cy, r, PALETTE.rose),
    disc(cx - r * 0.6, cy - r * 0.8, r * 0.3, PALETTE.rose), disc(cx + r * 0.6, cy - r * 0.8, r * 0.3, PALETTE.rose),
    disc(cx - r * 0.5, cy + r * 0.9, r * 0.25, PALETTE.rose), disc(cx + r * 0.5, cy + r * 0.9, r * 0.25, PALETTE.rose),
    disc(cx - r * 0.35, cy - r * 0.1, 3, PALETTE.ink), disc(cx + r * 0.35, cy - r * 0.1, 3, PALETTE.ink),
    chain([{ x: cx - r * 0.3, y: cy + r * 0.3, r: 2 }, { x: cx, y: cy + r * 0.45, r: 2 }, { x: cx + r * 0.3, y: cy + r * 0.3, r: 2 }], PALETTE.ink),
    ...[[x + w - 18, y + 12], [x + w - 30, y + 24]].map(([hx, hy]) => disc(hx, hy, 4, PALETTE.ember)),
  ];
}

module.exports = {
  title: 'TOMO',
  blurb: 'KEEP IT ALIVE',
  meta: {
    players: [1],
    rating: 'pg',
    audio: '8-bit',
    graphics: '2d',
    content: ['a pet that can sicken and die'],
  },
  accent: 'rose',
  emblem,
  create,
  GAME, MENU, PAUSE_MENU, HOW_TO, HOME_ICONS, CREATE_ROWS,
  ARCHETYPES, TEMPERS, PALATES, COATS, STAGES, FOODS, CARE, MINIGAMES, TOYS, DECOR, ACTIVITIES,
  MOODS, ILLNESSES, WEATHER, HOLIDAYS, VISITORS, DREAMS, BADGES, KINDS, FACETS,
  RATE, DAY, HOUR, MINUTE, TIRED, HUNGRY, FULL, BEDTIME, WAKE_HOUR, DIGEST, SAVE_VERSION, SAVE_EVERY,
  memoryStore, makeName, makeLook, weatherFor, xpFor, rng,
};
