import { expect, it } from 'vitest';
import { detailAnimation, type PoseDetail } from '@/render/duel/pose';
const body: PoseDetail = { grounded: true, crawling: false, crouch: 0, stun: 0, frozen: false, burning: false, stagger: 0, staggerDir: 0, facing: 1, skid: 0, swap: 0, fidget: 0, speed: 0, near: false, dead: false, finished: false, winner: false, entrance: 100, shieldHit: false };
it('shows reactions without overriding committed attacks', () => {
  expect(detailAnimation('hurt', {...body, grounded:false})).toBe('hurt_air');
  expect(detailAnimation('hurt', {...body, crawling:true})).toBe('hurt_crouch');
  expect(detailAnimation('hurt', {...body, staggerDir:1})).toBe('hurt_back');
  expect(detailAnimation('shield', {...body, shieldHit:true})).toBe('shield_hit');
  for(const [field,action] of [['frozen','frozen'],['burning','burning']] as const) {
    expect(detailAnimation('idle',{...body,[field]:true})).toBe(action);
    expect(detailAnimation('up_smash',{...body,[field]:true})).toBe('up_smash');
  }
});
it('finishes stance transitions and responds to actual movement', () => {
  const previous=(action:string,age=0)=>({action,age,frame:100});
  expect(detailAnimation('idle',body,previous('duck'))).toBe('stand_up');
  expect(detailAnimation('idle',body,previous('stand_up',12))).toBe('idle');
  expect(detailAnimation('land',body,previous('tumble'))).toBe('get_up');
  expect(detailAnimation('fall',{...body,grounded:false},previous('ledge_hang'))).toBe('ledge_release');
  expect(detailAnimation('run',{...body,speed:.8})).toBe('walk');
  expect(detailAnimation('run',{...body,speed:2},previous('idle'))).toBe('dash');
  expect(detailAnimation('run',{...body,speed:2},previous('dash',9))).toBe('run');
  expect(detailAnimation('idle',{...body,fidget:12})).toBe('taunt');
  expect(detailAnimation('idle',{...body,finished:true})).toBe('defeat');
  expect(detailAnimation('idle',{...body,finished:true,dead:true})).toBe('defeat');
});
