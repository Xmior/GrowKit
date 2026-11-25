// Names for items.dat numbers and flag bits, shared by the item editor and the archive diff.
// Values come from ITEMS_DAT_NOTES.md.
const namesByValue = (entries) => Object.fromEntries(entries.map(([value, label]) => [value, label]));
const ENUMS = {
  action_type: Object.fromEntries(ACTION_TYPES.map((name, value) => [value, name])),
  hit_sound_type: namesByValue([[0, "Wood"], [1, "Glass"], [2, "Rock"], [3, "Metal"]]),
  item_kind: namesByValue(["None", "Flame Lick", "Smoking", "Glow Tint", "Animated", "Bubbles", "Pet", "Pet Animated", "No Arms", "Wavey", "Wavey Animated", "Both Arms", "Low Hair", "Under Face", "Skin Tint", "Mask", "Animated Mask", "Low Hair Mask", "Ghost", "Pulse", "Colorize", "Colorize To Shirt", "Colorize Animated", "High Face", "High Face Animated", "Rainbow Shift", "Back and Front", "Colorize With Skin", "No Render", "Spin", "Off Hand", "Winged", "Sink", "Darkness", "Light Source", "Light If On", "Discolor", "Step Spin", "Pet Colored", "Silk Foot", "Tilty", "Tilty Dark", "Next Frame If On", "Wobble", "Scroll", "Light Source Pulse", "Bubble Machine", "Very Low Hair", "Very Low Hair Mask"].map((label, value) => [value, label])),
  spread_type: namesByValue(["Single Frame (Alone)", "Single Frame", "Smart Edge", "Smart Edge Horizontal", "Smart Cling", "Smart Edge Outer", "Random", "Smart Edge Vertical", "Smart Edge Horizontal Cave", "Smart Cling 2", "Smart Edge Diagonal"].map((label, value) => [value, label])),
  collision_type: namesByValue(["None", "Solid", "Jump Through", "Gateway", "If Off", "One Way", "VIP", "Jump Down", "Adventure", "If On", "Faction", "Guild", "Cloud", "Friends Entrance"].map((label, value) => [value, label])),
  clothing_type: namesByValue([[0, "Hat"], [1, "Shirt"], [2, "Pants"], [3, "Shoes"], [4, "Face"], [5, "Hand"], [6, "Back"], [7, "Hair"], [8, "Chest"]]),
};
const FLAGS = {
  editable_type: ["Flippable", "Editable", "Seedless", "Permanent", "Dropless", "No Self", "No Shadow", "World Locked"],
  item_category: ["Beta", "Auto Pickup", "Mod", "Random Grow", "Public", "Foreground", "Holiday", "Untradeable"],
  val2: ["Multi Anim", "Ping Pong Anim", "Overlay Object", "Offset Up", "Dual Layer", "Multi Anim 2", "Ping Pong Anim 2", "Use Skin Tint", "Seed Tint Layer 1", "Seed Tint Layer 2", "Rainbow Tint Layer 1", "Rainbow Tint Layer 2", "Glow", "No Arms", "Front Arm Punch", "Render Off Hand"],
  is_rayman: ["Slow Fall Object", "Replacement Sprite", "Orb Float", "Cape Foreground", "Variant Version"],
};
