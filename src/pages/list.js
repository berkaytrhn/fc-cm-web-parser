import { useEffect, useMemo, useState } from 'react'
import parser from '@/parser/parser'

const Buffer = require('buffer/').Buffer

// Polyfill/fallback for Object.fromEntries in older environments
const fromEntries = Object.fromEntries || function(entries) {
  const obj = {};
  for (let i = 0; i < entries.length; i++) {
    const pair = entries[i];
    if (!pair) continue;
    obj[pair[0]] = pair[1];
  }
  return obj;
}

// --- Helper functions copied/adapted from index.js parser UI ---
const dateToString = (fifaDate) => {
  return new Date(new Date('15 October 1582').getTime() + fifaDate * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

const mapPos = posId => {
  const map = {
    '-1': '',
    0: 'GK',
    3: 'RB',
    4: 'RCB',
    5: 'CB',
    6: 'LCB',
    7: 'LB',
    9: 'RDM',
    10: 'CDM',
    11: 'LDM',
    12: 'RM',
    13: 'RCM',
    14: 'CM',
    15: 'LCM',
    16: 'LM',
    17: 'RAM',
    18: 'CAM',
    19: 'LAM',
    20: 'RF',
    22: 'LF',
    23: 'RW',
    24: 'RS',
    25: 'ST',
    26: 'LS',
    27: 'LW',
  };
  return (typeof map[posId] !== 'undefined') ? map[posId] : '';
}

const intToBitmask = (val, length) => (new Uint32Array([val])[0] >>> 0).toString(2).padStart(length, '0')

const playstyles1 = [
  "Finesse Shot",
  "Chip Shot",
  "Power Shot",
  "Dead Ball",
  "Power Header",
  "Incisive Pass",
  "Pinged Pass",
  "Long Ball Pass",
  "Tiki Taka",
  "Whipped Cross",
  "Jockey",
  "Block",
  "Intercept",
  "Anticipate",
  "Slide Tackle",
  "Bruiser",
  "Technical",
  "Rapid",
  "Flair",
  "First Touch",
  "Trickster",
  "Press Proven",
  "Quick Step",
  "Relentless",
  "Trivela",
  "Acrobatic",
  "Long Throw",
  "Aerial",
  "Far Throw",
  "Footwork"
].reverse()
const playstyles2 = [
  'Cross Claimer',
  '1v1 Close Down',
  'Far Reach',
  'Quick Reflexes',
  'Long Shot Taker (CPU AI)',
  'Early Crosser (CPU AI)',
  'Solid Player',
  'Team Player',
  'One Club Player',
  'Injury Prone',
  'Leadership',
].reverse()

const parseTraitBitmask = (bitmask, traitNames) => bitmask.split('').reduce(
  (playstyles, bitMask, index) => {
      if (bitMask === '1') {
          playstyles.push(traitNames[index])
      }
      return playstyles
  },
  []
)

const getPlayStyles = (player) => {
  const trait1Bitmask = intToBitmask(player.trait1, playstyles1.length)
  const trait2Bitmask = intToBitmask(player.trait2, playstyles2.length)
  const playstyles = [...parseTraitBitmask(trait1Bitmask, playstyles1),
      ... parseTraitBitmask(trait2Bitmask, playstyles2)]
  return playstyles.join('|')
}

const getPlayStylesPlus = (player) => {
  const trait1Bitmask = intToBitmask(player.icontrait1, playstyles1.length)
  const trait2Bitmask = intToBitmask(player.icontrait2, playstyles2.length)
  const playstyles = [...parseTraitBitmask(trait1Bitmask, playstyles1),
      ... parseTraitBitmask(trait2Bitmask, playstyles2)]
  return playstyles.join('|')
}

const getPreferredPositions = player => [
  mapPos(player.preferredposition1),
  mapPos(player.preferredposition2),
  mapPos(player.preferredposition3),
  mapPos(player.preferredposition4),
].filter(pos => pos.length > 0).sort().join('|')

const getContractExpiry = player => player.teamid == 111592 ? '' : player.contractvaliduntil

const getAbilityStats = player => ({
  gk_diving: player.gkdiving,
  gk_reflexes: player.gkreflexes,
  gk_kicking: player.gkkicking,
  gk_handling: player.gkhandling,
  gk_positioning: player.gkpositioning,
  crossing: player.crossing,
  finishing: player.finishing,
  heading_accuracy: player.headingaccuracy,
  volleys: player.volleys,
  short_passing: player.shortpassing,
  dribbling: player.dribbling,
  curve: player.curve,
  freekick_accuracy: player.freekickaccuracy,
  long_passing: player.longpassing,
  ball_control: player.ballcontrol,
  acceleration: player.acceleration,
  sprint_speed: player.sprintspeed,
  agility: player.agility,
  reactions: player.reactions,
  balance: player.balance,
  shot_power: player.shotpower,
  jumping: player.jumping,
  stamina: player.stamina,
  strength: player.strength,
  long_shots: player.longshots,
  aggression: player.aggression,
  interceptions: player.interceptions,
  positioning: player.positioning,
  vision: player.vision,
  penalties: player.penalties,
  composure: player.composure,
  defensive_awareness: player.defensiveawareness,
  sliding_tackle: player.slidingtackle,
  standing_tackle: player.standingtackle,
})

// Quote-aware CSV row parser (handles "" escape, no newlines inside quotes).
const parseCsvRow = (line) => {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') { if (line[i+1] === '"') { cur += '"'; i++ } else { inQ = false } }
      else cur += c
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"') inQ = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}

const splitFullName = (full) => {
  if (!full) return ['', '']
  const i = full.indexOf(' ')
  return i < 0 ? [full, ''] : [full.slice(0, i), full.slice(i + 1)]
}

const dbToPlayersList = async(
  data,
  playerNamesFileContent,
  fcRosterCsvContent,
) => {
  const playerNamesByNameId = fromEntries(
    (playerNamesFileContent || '')
        .replaceAll('\r', '')
        .split('\n')
        .slice(1)
        .map(row => row.split(','))
        .map(([nameid, _, name]) => ([nameid, name]))
  )

  // FC26 roster (final_player_db.csv): playerid -> { name, ... }. Authoritative for base roster names.
  const fcRosterByPlayerId = {}
  if (fcRosterCsvContent) {
    const lines = fcRosterCsvContent.replace(/\r/g, '').split('\n')
    const header = parseCsvRow(lines[0])
    const idIdx = header.indexOf('ID')
    const nameIdx = header.indexOf('Name')
    if (idIdx >= 0 && nameIdx >= 0) {
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue
        const cols = parseCsvRow(lines[i])
        const id = cols[idIdx]
        if (id) fcRosterByPlayerId[id] = { name: cols[nameIdx] }
      }
    }
  }

  const teamLinksByTeamId = fromEntries((data[1]?.leagueteamlinks || []).map(teamLink => [teamLink.teamid, teamLink]))
  const teamsByTeamId  = fromEntries((data[1]?.teams || []).map(team => [team.teamid, team]))
  const leaguesByLeagueId = fromEntries((data[1]?.leagues || []).map(l => [l.leagueid, l]))

  // Career "now": earliest contract expiry year among contracted players. Falls back to today.
  const fifaEpoch = new Date('15 October 1582').getTime()
  const contractYears = (data[1]?.players || [])
    .map(p => p.contractvaliduntil)
    .filter(y => typeof y === 'number' && y >= 2000 && y <= 2100)
  const referenceYear = contractYears.length ? Math.min(...contractYears) : new Date().getFullYear()
  const computeAge = (birthdateDays) => {
    if (typeof birthdateDays !== 'number') return ''
    const bd = new Date(fifaEpoch + birthdateDays * 86400000)
    return referenceYear - bd.getFullYear()
  }

  // Save-internal name sources (FC26-accurate). Priority: editedplayernames > dcplayernames > playernames.csv.
  const editedByPlayerId = fromEntries((data[1]?.editedplayernames || []).map(e => [e.playerid, e]))
  const dcNameById = fromEntries((data[1]?.dcplayernames || []).map(d => [d.nameid, d.name]))
  const resolveName = (nameid) => dcNameById[nameid] ?? playerNamesByNameId[nameid] ?? ''

  const playersTable = (data[1]?.players || []).filter(player => player.gender == 0)

  const playersByPlayerId = fromEntries(playersTable.map(player => {
    const edited = editedByPlayerId[player.playerid]
    const roster = fcRosterByPlayerId[player.playerid]
    const [rosterFirst, rosterLast] = splitFullName(roster?.name)
    return [player.playerid, {
      player_id: player.playerid,
      first_name: (edited?.firstname && edited.firstname.charCodeAt(0) >= 32) ? edited.firstname : (rosterFirst || resolveName(player.firstnameid)),
      last_name: edited?.surname || rosterLast || resolveName(player.lastnameid),
      common_name: edited?.commonname || roster?.name || resolveName(player.commonnameid),
      current_team: '',
      owner_team: '',
      current_league: '',
      overall: player.overallrating,
      potential: player.potential,
      birthdate: dateToString(player.birthdate),
      age: computeAge(player.birthdate),
      preferred_position: getPreferredPositions(player),
      playstyles: getPlayStyles(player),
      playstyles_plus: getPlayStylesPlus(player),
      contract_expiry: getContractExpiry(player),
      wage: '',
      skill_moves: player.skillmoves,
      weak_foot: player.weakfootabilitytypecode,
      height: player.height,
      ...getAbilityStats(player),
      international_reputation: player.internationalrep,
    }]
  }));

  (data[1]?.teamplayerlinks || []).forEach(teamPlayerLink => {
      const player = playersByPlayerId[teamPlayerLink.playerid]
      const team = teamsByTeamId[teamPlayerLink.teamid]
      const teamLeagueId = teamLinksByTeamId[teamPlayerLink.teamid]?.leagueid

      if (typeof player != 'undefined' && typeof team != 'undefined' && teamLeagueId != 78) {
          player.current_team = team.teamname
          player.owner_team = team.teamname
          player.current_league = leaguesByLeagueId[teamLeagueId]?.leaguename ?? ''
      }
  });

  (data[0]?.career_playercontract || []).forEach(careerPlayerContract => {
      const player = playersByPlayerId[careerPlayerContract.playerid]

      if (typeof player != 'undefined') {
          player.wage = careerPlayerContract.wage
      }
  });

  (data[1]?.playerloans || []).forEach(playerLoan => {
      const player = playersByPlayerId[playerLoan.playerid]
      const ownerTeam = teamsByTeamId[playerLoan.teamidloanedfrom]

      if (typeof player != 'undefined' && typeof ownerTeam != 'undefined') {
          player.owner_team = ownerTeam.teamname
      }
  })

  return Object.values(playersByPlayerId)
}

function extractClubsFromData(data) {
  const map = {};
  (data || []).forEach(db => {
    if (!db) return;
    Object.keys(db).forEach(key => {
      if (!db[key] || !Array.isArray(db[key])) return;
      // heuristic: table names containing 'team' are likely clubs
      if (/team/i.test(key)) {
        db[key].forEach(item => {
          const id = item.teamid ?? item.team_id ?? item.teamId;
          if (!id && !item.teamname) return;
          const idx = id ?? item.teamname;
          map[idx] = { ...(map[idx] || {}), ...item };
        })
      }
    })
  })
  return Object.values(map)
}

const PAGE_SIZE = 50
const SORTABLE = ['overall','potential','age','contract_expiry','skill_moves','weak_foot','height','wage','international_reputation','common_name','first_name','last_name','current_team','current_league','preferred_position']
const NUMERIC = new Set(['overall','potential','age','contract_expiry','skill_moves','weak_foot','height','wage','international_reputation','player_id'])
const DEFAULT_FILTERS = { overallMin:'', overallMax:'', positions: [], teams: [], leagues: [], contractMin:'', contractMax:'', ageMin:'', ageMax:'', skillMovesMin:'', weakFootMin: '' }

const ui = {
  page: { padding: 24, fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif', background:'#f5f7fa', minHeight:'100vh', color:'#1f2937' },
  card: { background:'#fff', borderRadius: 10, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', padding: 16, marginBottom: 16 },
  h1: { margin:0, fontSize: 22, fontWeight: 700 },
  h3: { margin:'0 0 10px', fontSize: 13, fontWeight: 600, textTransform:'uppercase', color:'#6b7280', letterSpacing:0.4 },
  label: { display:'block', fontSize: 12, color:'#6b7280', marginBottom: 4 },
  input: { width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius: 6, fontSize: 13, background:'#fff', boxSizing:'border-box' },
  select: { width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius: 6, fontSize: 13, background:'#fff', boxSizing:'border-box' },
  button: { padding:'6px 12px', background:'#2563eb', color:'#fff', border:'none', borderRadius: 6, cursor:'pointer', fontSize: 13, fontWeight: 500 },
  buttonSecondary: { padding:'6px 12px', background:'#fff', color:'#374151', border:'1px solid #d1d5db', borderRadius: 6, cursor:'pointer', fontSize: 13 },
  th: { position:'sticky', top:0, background:'#f9fafb', borderBottom:'1px solid #e5e7eb', textAlign:'left', padding:'8px 10px', fontSize: 12, fontWeight:600, color:'#374151', cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' },
  td: { padding:'8px 10px', borderBottom:'1px solid #f1f5f9', fontSize: 13, whiteSpace:'nowrap' },
}

export default function ListPage() {
  const [dbMetaFileContent, setDbMetaFileContent] = useState(null)
  const [playerNamesFileContent, setPlayerNamesFileContent] = useState(null)
  const [fcRosterCsvContent, setFcRosterCsvContent] = useState(null)
  const [players, setPlayers] = useState([])
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [view, setView] = useState('players')
  const [search, setSearch] = useState('')
  const [visibleColumns, setVisibleColumns] = useState({})
  const [allColumns, setAllColumns] = useState([])
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState({ column: 'overall', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [showColumns, setShowColumns] = useState(false)

  useEffect(() => {
    fetch('/fifa_ng_db-meta.xml').then(r => r.text()).then(setDbMetaFileContent).catch(() => setDbMetaFileContent(null))
    fetch('/playernames.csv').then(r => r.text()).then(setPlayerNamesFileContent).catch(() => setPlayerNamesFileContent(null))
    fetch('/final_player_db.csv').then(r => r.ok ? r.text() : null).then(setFcRosterCsvContent).catch(() => setFcRosterCsvContent(null))
  }, [])

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setLoading(true)
      setError(null)
      try {
        if (!dbMetaFileContent) throw new Error('Missing fifa_ng_db-meta.xml in /public');
        if (!playerNamesFileContent) throw new Error('Missing playernames.csv in /public');

        const cmFileContentBuffer = Buffer.from(reader.result)
        const data = await parser.parseSave(cmFileContentBuffer, dbMetaFileContent)
        const playersList = await dbToPlayersList(data, playerNamesFileContent, fcRosterCsvContent)
        setPlayers(playersList)
        setAllColumns(Object.keys(playersList[0] || {}))
        const defaultCols = ['common_name','first_name','last_name','current_team','current_league','overall','potential','age','preferred_position','contract_expiry','skill_moves','weak_foot']
        const vis = {}
        Object.keys(playersList[0] || {}).forEach(c => { vis[c] = defaultCols.includes(c) })
        setVisibleColumns(vis)
        const clubsList = extractClubsFromData(data)
        setClubs(clubsList)
        setPage(1)
      } catch (err) {
        console.error(err)
        setError(err.message || String(err))
        alert(err.message || String(err))
      } finally {
        setLoading(false)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleUpload = (e) => handleFile(e.target.files && e.target.files[0])

  const uniquePositions = useMemo(() => {
    const set = new Set();
    players.forEach(p => { if (p.preferred_position) p.preferred_position.split('|').forEach(x => x && set.add(x)) })
    return Array.from(set).sort()
  }, [players])

  const uniqueTeams = useMemo(() => {
    const set = new Set();
    players.forEach(p => { if (p.current_team) set.add(p.current_team) })
    clubs.forEach(c => { if (c.teamname) set.add(c.teamname) })
    return Array.from(set).sort()
  }, [players, clubs])

  const uniqueLeagues = useMemo(() => {
    const set = new Set();
    players.forEach(p => { if (p.current_league) set.add(p.current_league) })
    return Array.from(set).sort()
  }, [players])

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return players.filter(p => {
      if (filters.overallMin && parseInt(p.overall || 0) < parseInt(filters.overallMin)) return false
      if (filters.overallMax && parseInt(p.overall || 0) > parseInt(filters.overallMax)) return false
      if (filters.skillMovesMin && parseInt(p.skill_moves || 0) < parseInt(filters.skillMovesMin)) return false
      if (filters.weakFootMin && parseInt(p.weak_foot || 0) < parseInt(filters.weakFootMin)) return false
      if (filters.contractMin && parseInt(p.contract_expiry || 0) < parseInt(filters.contractMin)) return false
      if (filters.contractMax && parseInt(p.contract_expiry || 0) > parseInt(filters.contractMax)) return false
      if (filters.ageMin && parseInt(p.age || 0) < parseInt(filters.ageMin)) return false
      if (filters.ageMax && parseInt(p.age || 0) > parseInt(filters.ageMax)) return false
      if (filters.positions.length && !filters.positions.some(pos => (p.preferred_position || '').split('|').includes(pos))) return false
      if (filters.teams.length && !(filters.teams.includes(p.current_team) || filters.teams.includes(p.owner_team))) return false
      if (filters.leagues.length && !filters.leagues.includes(p.current_league)) return false
      if (q) {
        const hay = `${p.common_name} ${p.first_name} ${p.last_name} ${p.current_team} ${p.current_league}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [players, filters, search])

  const sortedPlayers = useMemo(() => {
    if (!sort.column) return filteredPlayers
    const dir = sort.direction === 'asc' ? 1 : -1
    const isNum = NUMERIC.has(sort.column)
    const arr = filteredPlayers.slice()
    arr.sort((a, b) => {
      const av = a[sort.column], bv = b[sort.column]
      if (isNum) return ((parseFloat(av) || 0) - (parseFloat(bv) || 0)) * dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir
    })
    return arr
  }, [filteredPlayers, sort])

  const filteredClubs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clubs.filter(c => {
      if (q) {
        const hay = Object.values(c).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.teams.length && !filters.teams.includes(c.teamname)) return false
      return true
    })
  }, [clubs, filters, search])

  const totalRows = view === 'players' ? sortedPlayers.length : filteredClubs.length
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return (view === 'players' ? sortedPlayers : filteredClubs).slice(start, start + PAGE_SIZE)
  }, [view, sortedPlayers, filteredClubs, currentPage])

  useEffect(() => { setPage(1) }, [filters, search, view, sort])

  const toggleColumn = (col) => setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }))
  const resetFilters = () => setFilters(DEFAULT_FILTERS)
  const onSort = (col) => {
    if (!SORTABLE.includes(col)) return
    setSort(s => s.column === col ? { column: col, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { column: col, direction: NUMERIC.has(col) ? 'desc' : 'asc' })
  }
  const sortIndicator = (col) => sort.column === col ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : (SORTABLE.includes(col) ? ' ⇅' : '')

  const visibleCols = view === 'players' ? allColumns.filter(c => visibleColumns[c]) : Object.keys(clubs[0] || {}).filter(k => visibleColumns[k])

  return (
    <div style={ui.page}>
      <div style={{ ...ui.card, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <h1 style={ui.h1}>FC26 Career Mode Explorer</h1>
        <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
          <input type="file" onChange={handleUpload} style={{ fontSize: 13 }} />
          {loading && <span style={{ color:'#2563eb', fontSize: 13 }}>Parsing…</span>}
        </div>
      </div>

      <div style={ui.card}>
        <div style={{ display:'flex', gap: 12, alignItems:'center', marginBottom: 12 }}>
          <select value={view} onChange={e => setView(e.target.value)} style={{ ...ui.select, width: 140 }}>
            <option value="players">Players</option>
            <option value="clubs">Clubs</option>
          </select>
          <input style={{ ...ui.input, flex: 1 }} placeholder="Search name, team, league…" value={search} onChange={e => setSearch(e.target.value)} />
          <button style={ui.buttonSecondary} onClick={() => setShowColumns(v => !v)}>{showColumns ? 'Hide columns' : 'Show columns'}</button>
          <button style={ui.buttonSecondary} onClick={() => { setSearch(''); resetFilters() }}>Reset</button>
        </div>

        {view === 'players' && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label style={ui.label}>Overall</label>
              <div style={{ display:'flex', gap: 6 }}>
                <input style={ui.input} type="number" placeholder="min" value={filters.overallMin} onChange={e => setFilters(f => ({ ...f, overallMin: e.target.value }))} />
                <input style={ui.input} type="number" placeholder="max" value={filters.overallMax} onChange={e => setFilters(f => ({ ...f, overallMax: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={ui.label}>Contract expiry</label>
              <div style={{ display:'flex', gap: 6 }}>
                <input style={ui.input} type="number" placeholder="from yr" value={filters.contractMin} onChange={e => setFilters(f => ({ ...f, contractMin: e.target.value }))} />
                <input style={ui.input} type="number" placeholder="to yr" value={filters.contractMax} onChange={e => setFilters(f => ({ ...f, contractMax: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={ui.label}>Age</label>
              <div style={{ display:'flex', gap: 6 }}>
                <input style={ui.input} type="number" placeholder="min" value={filters.ageMin} onChange={e => setFilters(f => ({ ...f, ageMin: e.target.value }))} />
                <input style={ui.input} type="number" placeholder="max" value={filters.ageMax} onChange={e => setFilters(f => ({ ...f, ageMax: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={ui.label}>Skill moves ≥</label>
              <input style={ui.input} type="number" min="1" max="5" value={filters.skillMovesMin} onChange={e => setFilters(f => ({ ...f, skillMovesMin: e.target.value }))} />
            </div>
            <div>
              <label style={ui.label}>Weak foot ≥</label>
              <input style={ui.input} type="number" min="1" max="5" value={filters.weakFootMin} onChange={e => setFilters(f => ({ ...f, weakFootMin: e.target.value }))} />
            </div>
            <div>
              <label style={ui.label}>Positions ({filters.positions.length || 'any'})</label>
              <select style={{ ...ui.select, minHeight: 90 }} multiple value={filters.positions} onChange={e => setFilters(f => ({ ...f, positions: Array.from(e.target.selectedOptions).map(o => o.value) }))}>
                {uniquePositions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={ui.label}>Leagues ({filters.leagues.length || 'any'})</label>
              <select style={{ ...ui.select, minHeight: 90 }} multiple value={filters.leagues} onChange={e => setFilters(f => ({ ...f, leagues: Array.from(e.target.selectedOptions).map(o => o.value) }))}>
                {uniqueLeagues.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={ui.label}>Clubs ({filters.teams.length || 'any'})</label>
              <select style={{ ...ui.select, minHeight: 90 }} multiple value={filters.teams} onChange={e => setFilters(f => ({ ...f, teams: Array.from(e.target.selectedOptions).map(o => o.value) }))}>
                {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        )}

        {view === 'clubs' && (
          <div>
            <label style={ui.label}>Clubs filter</label>
            <select style={{ ...ui.select, minHeight: 100 }} multiple value={filters.teams} onChange={e => setFilters(f => ({ ...f, teams: Array.from(e.target.selectedOptions).map(o => o.value) }))}>
              {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {showColumns && (
        <div style={ui.card}>
          <h3 style={ui.h3}>Visible columns</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap: 4, maxHeight: 240, overflow:'auto' }}>
            {(view === 'players' ? allColumns : Object.keys(clubs[0] || {})).map(col => (
              <label key={col} style={{ fontSize: 12, color:'#374151' }}>
                <input type="checkbox" checked={!!visibleColumns[col]} onChange={() => toggleColumn(col)} /> {col}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={ui.card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 10 }}>
          <h3 style={ui.h3}>{view === 'players' ? 'Players' : 'Clubs'} — {totalRows.toLocaleString()} match{totalRows === 1 ? '' : 'es'}</h3>
          <Pagination page={currentPage} totalPages={totalPages} setPage={setPage} />
        </div>
        <div style={{ overflow:'auto', maxHeight:'65vh', border:'1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead>
              <tr>
                {visibleCols.map(col => (
                  <th key={col} style={ui.th} onClick={() => view === 'players' && onSort(col)} title={SORTABLE.includes(col) && view === 'players' ? 'Click to sort' : ''}>
                    {col}{view === 'players' && sortIndicator(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => (
                <tr key={idx} style={{ background: idx % 2 ? '#fafbfc' : '#fff' }}>
                  {visibleCols.map(col => (
                    <td key={col} style={ui.td}>{String(row[col] ?? '')}</td>
                  ))}
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={visibleCols.length || 1} style={{ ...ui.td, textAlign:'center', color:'#9ca3af', padding: 24 }}>No matches</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, display:'flex', justifyContent:'flex-end' }}>
          <Pagination page={currentPage} totalPages={totalPages} setPage={setPage} />
        </div>
      </div>

      {error && <div style={{ ...ui.card, color:'#b91c1c', background:'#fef2f2' }}>{error}</div>}
    </div>
  )
}

function Pagination({ page, totalPages, setPage }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 6, fontSize: 13 }}>
      <button style={ui.buttonSecondary} disabled={page <= 1} onClick={() => setPage(1)}>«</button>
      <button style={ui.buttonSecondary} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>
      <span style={{ color:'#6b7280' }}>Page</span>
      <input style={{ ...ui.input, width: 56, textAlign:'center' }} type="number" min={1} max={totalPages} value={page} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) setPage(Math.max(1, Math.min(totalPages, v))) }} />
      <span style={{ color:'#6b7280' }}>of {totalPages.toLocaleString()}</span>
      <button style={ui.buttonSecondary} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</button>
      <button style={ui.buttonSecondary} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</button>
    </div>
  )
}
