// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createT } from '@/i18n';
import type { CliSessionSummary } from '@/lib/api';
import { CliSessionsPanel } from './CliSessionsPanel';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/api', () => ({ isTauri: () => true, cliSessionsList: mocks.list }));
afterEach(() => cleanup());
const tr=createT('en');
function rows(n:number, eligible:number):CliSessionSummary[] {
 return Array.from({length:n}, (_,i)=>({agentSessionId:`id-${i}`, title:`Session ${i}`, cwd:'/tmp/project',updatedAt:'2026-11-14',dir:`/tmp/session-${i}`,numMessages:4,sourceHome:'/tmp/grok-home',alreadyLinked:false,bulkImportable:i<eligible}));
}
async function open(list:CliSessionSummary[]) {
 mocks.list.mockResolvedValue(list);
 render(<CliSessionsPanel t={tr} sessionDataMode="shared" />);
 fireEvent.click(screen.getByRole('button',{name:tr('settings.cliSessionsManage')}));
 return screen.findByRole('button',{name:tr('settings.cliSessionsDeleteUnlinked',{n:String(list.length)})});
}
describe('CLI import and delete have separate scopes',()=>{
 it('keeps all 75 deletions explicit while importing a batch of at most 50',async()=>{
  const del=await open(rows(75,75));
  expect(screen.getByRole('button',{name:tr('settings.cliSessionsImportAll',{n:'50'})}).hasAttribute('disabled')).toBe(false);
  expect(del.hasAttribute('disabled')).toBe(false);
  fireEvent.click(del);
  expect(screen.getByText(tr('settings.cliSessionsDeleteUnlinkedConfirmMsg',{n:'75'}))).toBeTruthy();
 });
 it('still allows deleting stubs when none qualify for bulk import',async()=>{
  const del=await open(rows(3,0));
  expect(screen.getByRole('button',{name:tr('settings.cliSessionsImportAll',{n:'0'})}).hasAttribute('disabled')).toBe(true);
  expect(del.hasAttribute('disabled')).toBe(false);
 });
});
