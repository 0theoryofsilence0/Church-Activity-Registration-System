// teamGen.js
// Pure utilities for generating balanced teams by gender and age.
// Exports:
// - generateTeams(nonLeaders, teamCount) => array of teams (each is array of attendees)
// - fullName(att) helper

/**
 * @typedef {{id:string, first_name:string, last_name:string, nickname?:string, congregation:string, gender:string, age:number, is_leader:boolean}} Attendee
 */

function fullName(a) {
  return `${a.first_name || ""} ${a.last_name || ""}`.trim();
}

function interleaveAges(arr) {
  // arr sorted ascending by age
  const res = [];
  let i = 0, j = arr.length - 1;
  while (i <= j) {
    if (i === j) res.push(arr[i]);
    else {
      res.push(arr[i]);
      res.push(arr[j]);
    }
    i++; j--;
  }
  return res;
}

/**
 * Deterministic distribution: for each gender bucket, sort by age asc, interleave to spread ages,
 * then round-robin assign across teams.
 * @param {Attendee[]} nonLeaders
 * @param {number} teamCount
 * @returns {Array<Array<Attendee>>}
 */
export function generateTeams(nonLeaders, teamCount, opts = { parity: 'strict' }) {
  const N = Math.max(0, Math.floor(teamCount));
  const teams = Array.from({length: N}, () => []);
  if (N === 0) return teams;

  // Group by gender (normalize keys)
  const genders = { Male: [], Female: [], Other: [] };
  nonLeaders.forEach(a => {
    const g = a.gender === 'Female' ? 'Female' : a.gender === 'Male' ? 'Male' : 'Other';
    genders[g].push(a);
  });

  // For each gender, sort by age asc and interleave to spread extremes
  const orderedByGender = {};
  ['Male','Female','Other'].forEach(g => {
    const bucket = genders[g].slice().sort((x,y)=> (x.age||0) - (y.age||0));
    orderedByGender[g] = interleaveAges(bucket);
  });

  // If strict parity requested, compute per-team quotas per gender and assign exactly
  if (opts && opts.parity === 'strict') {
    // helper: compute quota array for count over N teams
    const quotasFor = (count) => {
      const base = Math.floor(count / N);
      let extras = count % N;
      const q = Array.from({length: N}, () => base);
      // distribute extras one-per-team in round-robin to spread them
      for (let i = 0; i < extras; i++) q[i % N]++;
      return q;
    };

    const maleQ = quotasFor(orderedByGender['Male'].length);
    const femaleQ = quotasFor(orderedByGender['Female'].length);
    const otherQ = quotasFor(orderedByGender['Other'].length);

    // Assign per-team: for each team, take the required number from each gender list
    for (let t = 0; t < N; t++) {
      for (let k = 0; k < maleQ[t]; k++) {
        const m = orderedByGender['Male'].shift();
        if (m) teams[t].push(m);
      }
      for (let k = 0; k < femaleQ[t]; k++) {
        const f = orderedByGender['Female'].shift();
        if (f) teams[t].push(f);
      }
      for (let k = 0; k < otherQ[t]; k++) {
        const o = orderedByGender['Other'].shift();
        if (o) teams[t].push(o);
      }
    }

    // If any leftovers remain (shouldn't happen) append them round-robin
    const leftovers = [ ...orderedByGender['Male'], ...orderedByGender['Female'], ...orderedByGender['Other'] ];
    let li = 0;
    while (leftovers.length) {
      const item = leftovers.shift();
      teams[li % N].push(item);
      li++;
    }
  } else {
    // fallback: previous merged round-robin approach (best-effort)
    const merged = [];
    const genderOrder = ['Male','Female','Other'];
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (let g of genderOrder) {
        const list = orderedByGender[g];
        if (list && list.length) {
          const item = list.shift();
          if (item) merged.push(item);
          if (list.length) remaining = true;
        }
      }
    }
    // Now round-robin assign the merged list into teams
    for (let i=0;i<merged.length;i++) {
      const t = i % N;
      teams[t].push(merged[i]);
    }
  }

  // Finally, to spread mixed genders further, sort each team by age ascending (for presentation)
  for (let t=0;t<N;t++) {
    teams[t].sort((a,b)=>(a.age||0)-(b.age||0));
  }

  // Rebalance sizes so difference between any teams is at most 1
  const total = teams.reduce((s,tm)=>s+tm.length,0);
  const base = Math.floor(total / N);
  let extras = total % N; // number of teams that should have base+1
  const target = Array.from({length:N}, (_,i)=> extras>0 ? (base+1) : base);
  // extras assigned to first teams
  for (let i=0;i<extras;i++) target[i]=base+1;

  // Move members from overfull teams to underfull teams
  let changed = true;
  while (changed) {
    changed = false;
    for (let i=0;i<N;i++) {
      if (teams[i].length > target[i]) {
        // find smallest team needing a member
        const j = teams.findIndex((tm,idx)=> tm.length < target[idx]);
        if (j !== -1) {
          const m = teams[i].pop();
          teams[j].push(m);
          changed = true;
        }
      }
    }
  }

  return teams;
}

export { fullName };

// also export a small validator to compute average age
export function statsForTeams(teams) {
  return teams.map(members=>{
    const n = members.length;
    const avg = n ? members.reduce((s,a)=>s+(a.age||0),0)/n : 0;
    const genders = members.reduce((acc,a)=>{ acc[a.gender]= (acc[a.gender]||0)+1; return acc; },{});
    return { count: n, avgAge: avg, genders };
  });
}
