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



/**
 * Make N balanced groups by gender and age without using per-group averages.
 * Strategy:
 *  1) Split into gender pools.
 *  2) Sort each pool by age (young → old).
 *  3) "Snake" distribute each pool across groups (0→N-1, then N-1→0, repeat).
 *     - This spreads ages evenly and keeps gender counts balanced.
 *  4) Merge results from both gender passes.
 * @param {Attendee[]} nonLeaders
 * @param {number} teamCount
 * @returns {Array<Array<Attendee>>}
 */
export function generateTeams(nonLeaders, teamCount, opts = { parity: 'strict' }) {
  const N = Math.max(0, Math.floor(teamCount));
  const teams = Array.from({length: N}, () => []);
  if (N === 0) return teams;

  // 1) Split into gender pools and normalize gender keys
  const genderPools = { Male: [], Female: [], Other: [] };
  nonLeaders.forEach(a => {
    const g = a.gender === 'Female' ? 'Female' : a.gender === 'Male' ? 'Male' : 'Other';
    genderPools[g].push(a);
  });

  // Helper function for snake distribution
  function snakeDistribute(pool, teams) {
    if (pool.length === 0) return;
    
    const N = teams.length;
    let teamIndex = 0;
    let direction = 1; // 1 for forward (0→N-1), -1 for backward (N-1→0)
    
    for (let i = 0; i < pool.length; i++) {
      teams[teamIndex].push(pool[i]);
      
      // Move to next team in current direction
      teamIndex += direction;
      
      // If we've reached the end, reverse direction
      if (teamIndex >= N) {
        teamIndex = N - 2; // Start from second-to-last team
        direction = -1;
      } else if (teamIndex < 0) {
        teamIndex = 1; // Start from second team
        direction = 1;
      }
    }
  }

  // 2) Sort each pool by age (young → old)
  // 3) Snake distribute each gender pool across teams
  ['Male', 'Female', 'Other'].forEach(gender => {
    const pool = genderPools[gender].slice().sort((a, b) => (a.age || 0) - (b.age || 0));
    snakeDistribute(pool, teams);
  });

  // 4) Rebalance team sizes so difference between any teams is at most 1
  const total = teams.reduce((sum, team) => sum + team.length, 0);
  const targetSize = Math.floor(total / N);
  const teamsWithExtra = total % N; // number of teams that should have targetSize + 1
  
  // Calculate target sizes for each team
  const targetSizes = Array.from({length: N}, (_, i) => 
    i < teamsWithExtra ? targetSize + 1 : targetSize
  );
  
  // Rebalance by moving members from oversized teams to undersized teams
  let changed = true;
  while (changed) {
    changed = false;
    
    // Find oversized team
    for (let i = 0; i < N; i++) {
      if (teams[i].length > targetSizes[i]) {
        // Find undersized team
        for (let j = 0; j < N; j++) {
          if (teams[j].length < targetSizes[j]) {
            // Move member from team i to team j
            const member = teams[i].pop();
            teams[j].push(member);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
  }

  // 5) Final cleanup: sort each team by age for consistent presentation
  teams.forEach(team => {
    team.sort((a, b) => (a.age || 0) - (b.age || 0));
  });

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
