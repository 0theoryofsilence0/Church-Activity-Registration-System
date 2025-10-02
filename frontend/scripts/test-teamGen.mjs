import { generateTeams, statsForTeams } from '../src/utils/teamGen.js';

function makeAttendees(nMale=6, nFemale=8, nOther=1) {
  const res = [];
  let id = 1;
  for (let i=0;i<nMale;i++) res.push({id:`m${id++}`, first_name:'M', last_name:String(i), congregation:'A', gender:'Male', age:15+i, is_leader:false});
  for (let i=0;i<nFemale;i++) res.push({id:`f${id++}`, first_name:'F', last_name:String(i), congregation:'B', gender:'Female', age:14+i, is_leader:false});
  for (let i=0;i<nOther;i++) res.push({id:`o${id++}`, first_name:'O', last_name:String(i), congregation:'C', gender:'Other', age:16+i, is_leader:false});
  return res;
}

function approxEqual(a,b,eps=2) { return Math.abs(a-b) <= eps; }

const nonLeaders = makeAttendees(6,8,1);
const teams = generateTeams(nonLeaders, 3);
console.log('Team sizes:', teams.map(t=>t.length));
const stats = statsForTeams(teams);
console.log('Avg ages:', stats.map(s=>s.avgAge));
console.log('Genders per team:', stats.map(s=>s.genders));
// Basic asserts
if (!teams.length || Math.max(...teams.map(t=>t.length)) - Math.min(...teams.map(t=>t.length)) > 1) {
  console.error('Size imbalance > 1'); process.exit(1);
}
const avg = stats.map(s=>s.avgAge);
const maxAvg = Math.max(...avg), minAvg = Math.min(...avg);
if (!approxEqual(maxAvg,minAvg,2.5)) {
  console.error('Average age spread too large', avg); process.exit(1);
}
console.log('Basic checks passed');

// Also run strict parity and show results
const teamsStrict = generateTeams(nonLeaders, 3, { parity: 'strict' });
console.log('\nStrict parity: sizes', teamsStrict.map(t=>t.length));
const statsS = statsForTeams(teamsStrict);
console.log('Strict avg ages:', statsS.map(s=>s.avgAge));
console.log('Strict genders per team:', statsS.map(s=>s.genders));
