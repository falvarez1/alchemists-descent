import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The original job list is also provenance; a completed coverage report must not erase it.
if (await fs.access(path.join(root, 'prompts/brann-completion.json')).then(() => true, () => false)) {
  console.log('Existing Brann generation manifest preserved.');
  process.exit(0);
}
const read = async p => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const catalog = await read('../catalog.json');
const support = await read('../support-catalog.json');
const coverage = await read('coverage.json');
const motions = {
  run: 'A full heavy running cycle with alternating right and left leg contacts, knee compression, passing poses and airborne suspension. Both legs clearly change position. Return to first stride.',
  walk: 'Full deliberate walking cycle: right heel contact, compression, left leg passing, left heel contact, compression, right leg passing. Weight shifts over planted foot. No sliding or repeated stride phases.',
  dodge: 'Bend knees, tuck head and shoulders, one complete forward ground roll through side/back/inverted poses, plant a boot, unfold into guard. Never rotate on the depth axis.',
  dash: 'Anticipation crouch, explosive low forward stride, second long stride, shorten steps, return upright guard.',
  brake: 'Start running right, plant forward heel far ahead, lean torso back to resist momentum, bend knees, settle to standing.',
  tactical: 'Boiler Guard: draw guard inward, plant both feet, raise shield to cover torso and visor, brace low, sustain, lower into ready. Unarmed variant raises both empty forearms instead of a shield.',
  ultimate: 'Redline: crouch to build pressure, clench fists, rise and arch armored chest, flare elbows, tilt helm upward, hold powerful wide stance, then settle. Keep steam as separate effect, no particles on sheet.',
  double_jump: 'Airborne knees tuck toward chest, compress, kick both legs down, extend torso upward, ease into rising pose. No ground contact.',
  fast_fall: 'Airborne feet-first dive loop, arms tucked close, feet point down, knees and torso subtly counterbalance. No ground or smoke.',
  air_dodge: 'From airborne open pose draw knees in, tuck sideways, lean evasively, then unfold to falling pose. No full spin.',
  recovery: 'Deep crouch, forcefully push off with both legs, raise leading fist, extend into upward leap, reach apex and relax into falling pose.',
  wall_cling: 'Face right, both boots brace against invisible vertical wall to right, free hand grips above helm. Torso hangs back, slight weight shifts. Maintain hand contact at one fixed point. No wall drawn.',
  ledge_hang: 'Hang from INVISIBLE ledge at upper right with one gauntlet, elbow above helm, legs dangling below. A subtle pendulum swing under fixed gripping hand. Armed: shield stays on other arm, rod stowed on belt throughout. NO ledge or floor drawn.',
  ledge_climb: 'Start hanging by hand high to right, pull chest up, place right knee on invisible ledge, shift pelvis above knee, push to full standing. Show continuous vertical progression, no ledge drawn.',
  ledge_release: 'Start hanging from invisible ledge high to right, fingers open, hand lets go, torso drops and moves left, arms open into a fall. No platform drawn.',
  tumble: 'One complete 360-degree clockwise rotation IN THE SCREEN PLANE: upright, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330 degrees. Feet and helm orbit same fixed pelvis center, no yaw or changing camera.',
  get_up: 'Lie on back, curl forward, roll to hip, plant a gauntlet, bring one knee beneath body, push up, reach steady upright guard.',
  ko: 'Recoil backward, lose balance, fall onto back, shoulders contact first, legs settle, lie still. No blood or gore.',
  respawn: 'Float upright with legs relaxed, descend, extend boots, soft two-foot landing, knees compress, stand into ready guard.',
  victory: 'Start ready, lift one fist overhead triumphantly, hold chest high, then lower into confident standing pose. Keep equipment consistent.',
  neutral_air: 'Airborne tuck, open both arms into compact outward strike, extend, retract to falling guard. Startup then clear contact then recovery.',
  back_air: 'Airborne facing RIGHT throughout; twist shoulders slightly, drive rear elbow or shield behind toward LEFT, recoil, return to air guard.',
  up_air: 'Airborne compress, thrust gauntlet or pressure rod directly overhead, fully extend above helmet, retract into falling guard.',
  down_air: 'Airborne curl knees, drive armored boot and gauntlet straight down, extend, retract to falling guard.',
  up_smash: 'Grounded deep squat, draw striking arm low, explode into overhead uppercut, full arm above head, follow through, settle into guard.',
  down_smash: 'Grounded crouch, sweep low toward RIGHT, sweep behind toward LEFT without changing facing, deep follow-through, return to guard.',
  throw_back: 'Mime holding unseen opponent in front, turn shoulders and heave over left shoulder, release to LEFT, recover. No opponent visible.',
  throw_up: 'Mime grasping unseen opponent low, bend knees, drive both arms overhead, release upward, lower arms to guard. No opponent visible.',
  throw_down: 'Mime holding unseen opponent, raise arms, bend waist and forcefully slam toward floor, recoil to guard. No opponent visible.',
  cast_up: 'Raise pressure rod or empty palm vertically above helmet, steady aim UP, small recoil, lower to guard. No projectile or flash.',
  cast_down: 'Lean forward, aim pressure rod or empty palm straight DOWN beside forward boot, small recoil, return to guard. No projectile or flash.',
  cast_diagonal_up: 'Raise pressure rod or empty palm at 45 degrees UP RIGHT, steady aim, small recoil, lower to guard. No projectile or flash.',
  cast_diagonal_down: 'Aim pressure rod or empty palm at 45 degrees DOWN RIGHT, steady aim, small recoil, return to guard. No projectile or flash.',
  taunt: 'Confidently tap armored chest, then beckon opponent with free gauntlet, return to guard.',
  crouch_walk: 'Remain low in crouch for entire full walking cycle, alternate small right and left steps with clear passing poses.',
  shield_break: 'Guard takes shock, arms fly outward, torso recoils, stagger one step, wobble dazed. Shield remains attached and intact; break fragments are separate FX.',
  frozen: 'Tense immobilized guard with thin pale blue frost on armor edges, slight shivering changes. No floating ice effects or background.',
  burning: 'Flinch and pat shoulder, recoil from heat, regain guard. A few tiny attached amber flame pixels only; detached fire is separate FX.',
  grabbed: 'Lean forward with arms restrained by invisible opponent to right, struggle at elbows and knees, pull back, repeat. No second figure.',
  finisher: 'Deep grounded windup, draw fist back, committed heavy forward punch and lunge, full contact extension, long recoil, return to ready. Clear 4 startup, 4 contact, 4 recovery poses.',
};
const groups = Object.values(catalog.groups).flat();
const jobs = coverage.rows.filter(r => r.fighter === 'brann-rook' && r.status === 'missing').map(r => {
  const [,,loop] = groups.find(a => a[0] === r.action);
  const armed = r.equipment === 'armed';
  const motion = motions[r.action];
  if (!motion) throw new Error('Missing motion brief: '+r.action);
  return {id:r.id,kind:'fighter',source:'sources/'+r.id+'.png',cols:4,rows:3,count:12,loop,
    durationsTicks:Array(12).fill(loop?5:3),registration:'planted-feet',
    reference:'sources/brann-rook/'+r.equipment+'/idle.png',
    prompt:`Use case: stylized-concept. Create ONE detailed pixel-art animation sheet for Brann Rook, action ${r.action}. Attached image is an identity and rendering reference, not a pose layout to copy. Preserve heavy enclosed black iron helm with amber grille, brass rivets and chest gauge, shoulder lantern, back boiler, massive gauntlets and greaves. ${armed?'ARMED: exactly one tower shield attached to forward arm and one short brass pressure rod in other hand, retained throughout.':'UNARMED: empty gauntlets throughout. No held shield, rod, or other weapon.'}\nExactly TWELVE distinct successive animation frames in FOUR COLUMNS and THREE ROWS. Chronological left to right then down, every cell belongs to the same action. ${motion}\nRight-facing side view except specified screen-plane rotation. Identical body proportions and drawing scale throughout. True intermediate joint positions, continuous motion across row boundaries. Fighter occupies 65 percent of cell height; generous transparent gutters around every silhouette. Full equipment and limbs inside each cell. Crisp pixel clusters, no painterly gradients. Actual transparent RGBA background. No text, labels, grid, floor, shadows, opponent, attached scenery, motion echoes or extra objects.`};
});
// Replace the previously flagged 16-frame joined-silhouette source.
const repair={...jobs[0],id:'brann-rook/unarmed/finisher',source:'sources/brann-rook/unarmed/finisher-v2.png',loop:false,reference:'sources/brann-rook/unarmed/idle.png'};
repair.prompt=jobs.find(j=>j.id==='brann-rook/unarmed/up_smash').prompt.replaceAll('up_smash','finisher').replace(motions.up_smash,motions.finisher);
repair.phaseNames=[...Array(4).fill('startup'),...Array(4).fill('active'),...Array(4).fill('recovery')];
repair.durationsTicks=[6,6,6,5,1,1,1,2,8,8,8,9];
jobs.push(repair);
for(const [id,description] of support.flatMap(g=>g.actions).filter(a=>a[0].startsWith('brann-rook-'))) {
  const action=id.slice('brann-rook-'.length);
  jobs.push({id:'effects/brann-rook/'+action,kind:'effect',source:'sources/effects/brann-rook/'+action+'.png',cols:4,rows:3,count:12,loop:false,endBehavior:'hide',registration:'center',durationsTicks:Array(12).fill(3),reference:'sources/brann-rook/armed/idle.png',
    prompt:`Use case: stylized-concept. Transparent pixel-art VFX animation sheet, ONE effect in exactly 12 sequential frames, 4 columns by 3 rows. Brann Rook ${action}: ${description}. Reference supplies black iron, brass and warm amber palette only. DO NOT draw character, body, weapon, face, text or background. Animate clear small onset, buildup, strongest middle contact, dispersal and tiny final remnants. Each effect centered at same point and same scale in its cell, entirely inside cell with 20 percent empty transparent margin. Short readable game VFX with hard pixel clusters; steam may have translucent pixel clusters. No decorative border or grid. Actual transparent RGBA background.`});
}
await fs.writeFile(path.join(root,'prompts/brann-completion.json'),JSON.stringify(jobs,null,2)+'\n');
console.log(JSON.stringify({jobs:jobs.length,fighters:jobs.filter(j=>j.kind==='fighter').length,effects:jobs.filter(j=>j.kind==='effect').length}));
