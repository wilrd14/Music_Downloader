import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openCommand } from './opener';

test('openCommand: un binario con la ruta como único argumento, sin shell, en cada sistema', () => {
  const dir = 'C:\\Users\\ana\\Music\\a & calc.exe';
  assert.deepEqual(openCommand(dir, 'win32'), { cmd: 'explorer.exe', args: [dir] });
  assert.deepEqual(openCommand('/Users/ana/Music', 'darwin'), { cmd: 'open', args: ['/Users/ana/Music'] });
  assert.deepEqual(openCommand('/home/ana/$(rm -rf ~)', 'linux'), { cmd: 'xdg-open', args: ['/home/ana/$(rm -rf ~)'] });
});
