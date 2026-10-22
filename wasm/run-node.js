// Run irsim.wasm on a .sim file with a command script, the way a browser page would.
const fs = require('fs');
const createIrsim = require('./irsim.js');
async function run(prmPath, simText, commands) {
  const out = [];
  const input = Array.from(new TextEncoder().encode(commands + '\nexit\n'));
  const mod = await createIrsim({
    print: s => out.push(s), printErr: s => out.push(s),
    stdin: () => input.length ? input.shift() : null,
  });
  mod.FS.writeFile('/tech.prm', fs.readFileSync(prmPath));
  mod.FS.writeFile('/circuit.sim', simText);
  try { mod.callMain(['/tech.prm', '/circuit.sim']); } catch (e) { if (!/ExitStatus|exit/i.test(String(e))) throw e; }
  return out.join('\n');
}
module.exports = {run};
if (require.main === module) {
  const [prm, sim, cmd] = process.argv.slice(2);
  run(prm, fs.readFileSync(sim, 'utf8'), fs.readFileSync(cmd, 'utf8')).then(o => console.log(o));
}
