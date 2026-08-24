// A curated set, not the full Unicode emoji list — a few hundred of the
// ones people actually reach for, each with a short search string so
// typing "fire" or "laugh" finds the right one without needing an
// external emoji database. Keeps the reaction picker instant and
// offline-capable instead of depending on a CDN just to search emoji.

// The fixed "most used" row — not personalized, just the handful every
// major chat app defaults to (Slack, Facebook, iMessage all converge on
// roughly this set) since there's no real usage data to rank by yet.
export const TOP_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🙏'];

export const EMOJI_LIST = [
  ['😀', 'grinning happy smile'], ['😁', 'grin happy smile'], ['😂', 'laugh cry funny lol'],
  ['🤣', 'rofl laugh funny'], ['😊', 'smile happy blush'], ['😍', 'love heart eyes crush'],
  ['🥰', 'love hearts adore'], ['😘', 'kiss love'], ['😎', 'cool sunglasses'],
  ['🤩', 'star struck excited'], ['🥳', 'party celebrate birthday'], ['😇', 'angel innocent halo'],
  ['🙂', 'smile slight'], ['🙃', 'upside down silly'], ['😉', 'wink'],
  ['😋', 'yum tasty tongue'], ['😜', 'wink tongue silly'], ['🤪', 'crazy silly wild'],
  ['🤔', 'thinking hmm'], ['🫡', 'salute respect'], ['🤨', 'skeptical suspicious'],
  ['😐', 'neutral meh'], ['😑', 'expressionless blank'], ['😶', 'speechless quiet'],
  ['🙄', 'eyeroll annoyed'], ['😏', 'smirk sly'], ['😴', 'sleep tired zzz'],
  ['🤤', 'drool hungry'], ['😪', 'sleepy tired'], ['😵', 'dizzy dead'],
  ['🤯', 'mind blown shocked'], ['😳', 'flushed embarrassed shocked'], ['🥵', 'hot sweating'],
  ['🥶', 'cold freezing'], ['😱', 'scream scared shocked'], ['😨', 'fear scared'],
  ['😰', 'anxious nervous sweat'], ['😥', 'sad disappointed'], ['😢', 'cry sad tear'],
  ['😭', 'sob crying bawling'], ['😤', 'angry huff frustrated'], ['😠', 'angry mad'],
  ['😡', 'rage furious angry'], ['🤬', 'cursing furious angry'], ['🤢', 'sick nauseous gross'],
  ['🤮', 'vomit sick gross'], ['🥴', 'woozy drunk dizzy'], ['😷', 'sick mask ill'],
  ['🤒', 'sick fever ill'], ['🤕', 'hurt injured bandage'], ['🥹', 'holding back tears touched'],
  ['💀', 'skull dead dying'], ['👻', 'ghost spooky'], ['👽', 'alien'],
  ['🤖', 'robot bot'], ['🎃', 'pumpkin halloween'], ['😺', 'cat happy'],
  ['👍', 'thumbs up like yes good'], ['👎', 'thumbs down dislike no bad'], ['👏', 'clap applause'],
  ['🙌', 'praise hands up celebrate'], ['🤝', 'handshake deal agree'], ['🙏', 'pray please thanks hope'],
  ['💪', 'muscle strong flex'], ['👀', 'eyes look watching'], ['👋', 'wave hello bye'],
  ['✌️', 'peace victory'], ['🤞', 'fingers crossed hope luck'], ['👌', 'ok perfect good'],
  ['🤙', 'call hang loose'], ['👊', 'fist bump punch'], ['✊', 'fist power'],
  ['💯', '100 perfect score'], ['🔥', 'fire lit hot great'], ['✨', 'sparkles shiny new'],
  ['⭐', 'star favorite'], ['🌟', 'star glowing'], ['💫', 'dizzy star'],
  ['⚡', 'lightning fast bolt zap'], ['💥', 'boom explosion impact'], ['💢', 'anger mad'],
  ['💦', 'sweat splash water'], ['💨', 'dash wind fast'], ['🕳️', 'hole trap'],
  ['❤️', 'heart love red'], ['🧡', 'heart orange'], ['💛', 'heart yellow'],
  ['💚', 'heart green'], ['💙', 'heart blue'], ['💜', 'heart purple'],
  ['🖤', 'heart black'], ['🤍', 'heart white'], ['🤎', 'heart brown'],
  ['💔', 'broken heart heartbreak sad'], ['❣️', 'heart exclamation'], ['💕', 'hearts love'],
  ['💞', 'hearts revolving love'], ['💓', 'heartbeat pulse love'], ['💗', 'heart growing love'],
  ['💖', 'sparkling heart love'], ['💘', 'heart arrow love cupid'], ['💝', 'heart gift love'],
  ['🎮', 'game controller gaming'], ['🕹️', 'joystick gaming retro'], ['🏆', 'trophy win champion'],
  ['🥇', 'gold medal first winner'], ['🎯', 'target bullseye goal'], ['🎲', 'dice game luck'],
  ['🧩', 'puzzle piece'], ['🎬', 'clapperboard movie film'], ['🎧', 'headphones music'],
  ['🎵', 'music note'], ['🎉', 'party popper celebrate'], ['🎊', 'confetti celebrate'],
  ['🎁', 'gift present'], ['🏅', 'medal award'], ['⚽', 'soccer football'],
  ['🍕', 'pizza food'], ['🍔', 'burger food'], ['🍟', 'fries food'],
  ['🍿', 'popcorn movie snack'], ['🍩', 'donut sweet'], ['🍫', 'chocolate sweet'],
  ['☕', 'coffee drink'], ['🍺', 'beer drink'], ['🍰', 'cake dessert birthday'],
  ['🐶', 'dog puppy pet'], ['🐱', 'cat kitten pet'], ['🦁', 'lion'],
  ['🐸', 'frog'], ['🐢', 'turtle slow'], ['🦄', 'unicorn'],
  ['🚀', 'rocket launch fast'], ['🛸', 'ufo alien'], ['🌈', 'rainbow'],
  ['☀️', 'sun sunny bright'], ['🌙', 'moon night'], ['⛅', 'cloud weather'],
  ['❄️', 'snow snowflake cold'], ['🌊', 'wave ocean sea'], ['🌸', 'flower blossom'],
  ['💧', 'water drop tear'], ['📸', 'camera photo picture'], ['📱', 'phone mobile'],
  ['💻', 'laptop computer'], ['⌚', 'watch time'], ['💡', 'idea lightbulb'],
  ['🔒', 'lock private secure'], ['🔑', 'key unlock'], ['💰', 'money cash rich'],
  ['💸', 'money flying cash spend'], ['📈', 'chart up growth trending'], ['📉', 'chart down decline'],
  ['✅', 'check done complete yes'], ['❌', 'x cancel no wrong'], ['⚠️', 'warning caution alert'],
  ['❓', 'question confused'], ['❗', 'exclamation important'], ['💤', 'sleep zzz tired'],
];

const norm = (s) => s.toLowerCase().trim();

export function searchEmoji(query) {
  const q = norm(query);
  if (!q) return EMOJI_LIST.map((e) => e[0]);
  return EMOJI_LIST.filter(([emoji, keywords]) => keywords.includes(q)).map(([emoji]) => emoji);
}
