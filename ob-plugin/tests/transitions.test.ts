import { describe, expect, it } from 'vitest';
import { parseKosObject } from '../src/core/parse';
import { canTransition, currentState, fieldRequiresConfirmation, legalTransitions } from '../src/core/transitions';
import type { KosObject } from '../src/core/model';

/** 内联构造对象（走 parse 保证与真实路径一致） */
function mk(type: string, extra: Record<string, unknown> = {}): KosObject {
  const o = parseKosObject({ type, created: '2026-07-01', ...extra }, `${type}.md`);
  if (!o) throw new Error(`parse failed: ${type}`);
  return o;
}

describe('legalTransitions', () => {
  it('source：captured 可去 extracted 或 ignored，均不需确认', () => {
    const targets = legalTransitions(mk('source', { status: 'captured' }));
    expect(targets.map((t) => t.to).sort()).toEqual(['extracted', 'ignored']);
    expect(targets.every((t) => !t.requiresConfirmation)).toBe(true);
  });

  it('source：linked 可 archived/ignored，reviewed 可 linked/ignored', () => {
    expect(legalTransitions(mk('source', { status: 'linked' })).map((t) => t.to).sort()).toEqual([
      'archived',
      'ignored',
    ]);
    expect(legalTransitions(mk('source', { status: 'reviewed' })).map((t) => t.to).sort()).toEqual([
      'ignored',
      'linked',
    ]);
  });

  it('冻结/终态返回空列表', () => {
    expect(legalTransitions(mk('source', { status: 'archived' }))).toEqual([]);
    expect(legalTransitions(mk('source', { status: 'ignored' }))).toEqual([]);
    expect(legalTransitions(mk('task', { status: 'done' }))).toEqual([]);
    expect(legalTransitions(mk('task', { status: 'cancelled' }))).toEqual([]);
    expect(legalTransitions(mk('method', { status: 'deprecated' }))).toEqual([]);
    expect(legalTransitions(mk('project', { status: 'cancelled' }))).toEqual([]);
  });

  it('无状态机对象返回空列表', () => {
    expect(legalTransitions(mk('diary', { date: '2026-07-19' }))).toEqual([]);
    expect(legalTransitions(mk('signal'))).toEqual([]);
    expect(legalTransitions(mk('dashboard'))).toEqual([]);
  });

  it('extract/summary：确认型单步流转', () => {
    const ex = legalTransitions(mk('extract'));
    expect(ex).toEqual([{ to: 'reviewed', requiresConfirmation: true, note: expect.any(String) }]);
    const su = legalTransitions(mk('summary'));
    expect(su).toEqual([{ to: 'true', requiresConfirmation: true, note: expect.any(String) }]);
    // 已审核后无流转
    expect(legalTransitions(mk('extract', { review_status: 'reviewed' }))).toEqual([]);
    expect(legalTransitions(mk('summary', { reviewed: true }))).toEqual([]);
  });

  it('research：draft→reviewed 需确认，complete→archived 不需', () => {
    const t1 = legalTransitions(mk('research', { status: 'draft' }));
    expect(t1).toEqual([{ to: 'reviewed', requiresConfirmation: true, note: expect.any(String) }]);
    const t2 = legalTransitions(mk('research', { status: 'complete' }));
    expect(t2).toEqual([{ to: 'archived', requiresConfirmation: false }]);
  });

  it('concept：全部晋升需确认', () => {
    expect(legalTransitions(mk('concept', { status: 'draft' }))[0].requiresConfirmation).toBe(true);
    expect(legalTransitions(mk('concept', { status: 'verified' }))[0]).toMatchObject({
      to: 'mature',
      requiresConfirmation: true,
    });
    expect(legalTransitions(mk('concept', { status: 'mature' }))).toEqual([]);
  });

  it('project：非终态自由流转，不含自身', () => {
    const targets = legalTransitions(mk('project', { status: 'active' })).map((t) => t.to);
    expect(targets.sort()).toEqual(['archived', 'cancelled', 'completed', 'idea', 'paused']);
  });

  it('task：todo→doing/blocked/cancelled，doing→done/blocked/cancelled', () => {
    expect(legalTransitions(mk('task', { status: 'todo' })).map((t) => t.to).sort()).toEqual([
      'blocked',
      'cancelled',
      'doing',
    ]);
    expect(legalTransitions(mk('task', { status: 'doing' })).map((t) => t.to).sort()).toEqual([
      'blocked',
      'cancelled',
      'done',
    ]);
  });

  it('method：晋升需确认并带规范依据，deprecated 任意可去且不需确认', () => {
    const cand = legalTransitions(mk('method', { status: 'candidate' }));
    expect(cand.find((t) => t.to === 'usable')).toMatchObject({
      requiresConfirmation: true,
      note: expect.stringContaining('1+'),
    });
    expect(cand.find((t) => t.to === 'deprecated')?.requiresConfirmation).toBe(false);
    const trusted = legalTransitions(mk('method', { status: 'trusted' }));
    expect(trusted).toEqual([{ to: 'deprecated', requiresConfirmation: false }]);
  });

  it('personal_operating_profile：晋升需确认，archived 不需', () => {
    expect(legalTransitions(mk('personal_operating_profile', { status: 'draft' }))[0].requiresConfirmation).toBe(
      true,
    );
    expect(
      legalTransitions(mk('personal_operating_profile', { status: 'active' })),
    ).toEqual([{ to: 'archived', requiresConfirmation: false }]);
  });
});

describe('canTransition / currentState / 字段级权限', () => {
  it('canTransition 校验单次流转', () => {
    const s = mk('source', { status: 'captured' });
    expect(canTransition(s, 'extracted')).toBe(true);
    expect(canTransition(s, 'linked')).toBe(false);
    const t = mk('task', { status: 'done' });
    expect(canTransition(t, 'todo')).toBe(false);
  });

  it('currentState：summary 用字符串布尔', () => {
    expect(currentState(mk('summary', { reviewed: false }))).toBe('false');
    expect(currentState(mk('extract'))).toBe('pending');
    expect(currentState(mk('diary'))).toBeNull();
  });

  it('project 的 goal/priority 修改需人确认，其他字段不需要', () => {
    const p = mk('project');
    expect(fieldRequiresConfirmation(p, 'goal')).toBe(true);
    expect(fieldRequiresConfirmation(p, 'priority')).toBe(true);
    expect(fieldRequiresConfirmation(p, 'title')).toBe(false);
    expect(fieldRequiresConfirmation(mk('task'), 'goal')).toBe(false);
  });
});
