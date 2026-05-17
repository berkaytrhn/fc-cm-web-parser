import { useEffect, useState } from 'react'
import parser from '@/parser/parser'

const Buffer = require('buffer/').Buffer

const toCsv = (data, keys) => {
  if (typeof keys === 'undefined') {
      keys = Array.from(Object.keys(data[0]))
  }

  const result = [
    keys.join(','),
    ...data.map(row => keys.map(key => row[key] ?? '').join(','))
  ]

  return result.join('\n')
}

const dateToString = (fifaDate) => {    
  return new Date(new Date('15 October 1582').getTime() + fifaDate * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

const mapPos = posId => ({
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
})[posId]

const parseTraitBitmask = (bitmask, traitNames) => bitmask.split('').reduce(
  (playstyles, bitMask, index) => {
      if (bitMask === '1') {
          playstyles.push(traitNames[index])
      }
      return playstyles
  },
  []
)

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
  // GK
  gk_diving: player.gkdiving,
  gk_reflexes: player.gkreflexes,
  gk_kicking: player.gkkicking,
  gk_handling: player.gkhandling,
  gk_positioning: player.gkpositioning,

  // Attacking
  crossing: player.crossing,
  finishing: player.finishing,
  heading_accuracy: player.headingaccuracy,
  volleys: player.volleys,
  short_passing: player.shortpassing,

  // Ability
  dribbling: player.dribbling,
  curve: player.curve,
  freekick_accuracy: player.freekickaccuracy,
  long_passing: player.longpassing,
  ball_control: player.ballcontrol,
  
  // Movement
  acceleration: player.acceleration,
  sprint_speed: player.sprintspeed,
  agility: player.agility,
  reactions: player.reactions,
  balance: player.balance,

  // Power
  shot_power: player.shotpower,
  jumping: player.jumping,
  stamina: player.stamina,
  strength: player.strength,
  long_shots: player.longshots,

  // Mentality
  aggression: player.aggression,
  interceptions: player.interceptions,
  positioning: player.positioning,
  vision: player.vision,
  penalties: player.penalties,
  composure: player.composure,

  // Defending
  defensive_awareness: player.defensiveawareness,
  sliding_tackle: player.slidingtackle,
  standing_tackle: player.standingtackle,
})

const dbToPlayersList = async(
  data,
  playerNamesFileContent,
) => {
  const playerNamesByNameId = Object.fromEntries(
    playerNamesFileContent
        .replaceAll('\r', '')
        .split('\n')
        .slice(1)
        .map(row => row.split(','))
        .map(([nameid, _, name]) => ([nameid, name]))
  )

  const teamLinksByTeamId = Object.fromEntries(data[1].leagueteamlinks.map(teamLink => [teamLink.teamid, teamLink]))
  const teamsByTeamId  = Object.fromEntries(data[1].teams.map(team => [team.teamid, team]))

  const playersTable = data[1].players.filter(player => player.gender == 0)
  
  const playersByPlayerId = Object.fromEntries(playersTable.map(player => [player.playerid, {
      player_id: player.playerid,
      first_name: playerNamesByNameId[player.firstnameid] ?? '',
      last_name: playerNamesByNameId[player.lastnameid] ?? '',
      common_name: playerNamesByNameId[player.commonnameid] ?? '',
      current_team: '',
      owner_team: '',
      overall: player.overallrating,
      potential: player.potential,
      birthdate: dateToString(player.birthdate),
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
  }]))

  data[1].teamplayerlinks.forEach(teamPlayerLink => {
      const player = playersByPlayerId[teamPlayerLink.playerid]
      const team = teamsByTeamId[teamPlayerLink.teamid]
      const teamLegueId = teamLinksByTeamId[teamPlayerLink.teamid]?.leagueid

      if (typeof player != 'undefined' && typeof team != 'undefined' && teamLegueId != 78) {
          player.current_team = team.teamname
          player.owner_team = team.teamname
      }
  })

  data[0].career_playercontract.forEach(careerPlayerContract => {
      const player = playersByPlayerId[careerPlayerContract.playerid]

      if (typeof player != 'undefined') {
          player.wage = careerPlayerContract.wage
      }
  })

  data[1].playerloans.forEach(playerLoan => {
      const player = playersByPlayerId[playerLoan.playerid]
      const ownerTeam = teamsByTeamId[playerLoan.teamidloanedfrom]

      if (typeof player != 'undefined' && typeof ownerTeam != 'undefined') {
          player.owner_team = ownerTeam.teamname
      }
  })

  return Object.values(playersByPlayerId)
}

function downloadStringAsFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const parseCmFile = async(
  cmFile,
  dbMetaFileContent,
  playerNamesFileContent
) => {
  const reader = new FileReader();
  reader.readAsArrayBuffer(cmFile);
  reader.onload = async() => {
    const cmFileContentBuffer = new Buffer(reader.result)

    try {
      const data = await parser.parseSave(
        cmFileContentBuffer,
        dbMetaFileContent
      )

      const players = await dbToPlayersList(data, playerNamesFileContent)
      const playersCsv = toCsv(players)
      downloadStringAsFile('players.csv', playersCsv)
    } catch (err) {
      console.error(err)
      alert(err.message || String(err))
    }
  }
}

export default function Home() {
  const [dbMetaFileContent, setDbMetaFileContent] = useState(null);
  const [playerNamesFileContent, setPlayerNamesFileContent] = useState(null)

  useEffect(async() => {
    const response = await fetch('./fifa_ng_db-meta.xml')
    setDbMetaFileContent(await response.text())
  }, [])

  useEffect(async() => {
    const response = await fetch('./playernames.csv')
    setPlayerNamesFileContent(await response.text())
  }, [])
  
  const handleFileUpload = (event) => {
    parseCmFile(
      event.target.files[0],
      dbMetaFileContent,
      playerNamesFileContent
    )
  }

  return (
    <div>
      <input type="file" onChange={handleFileUpload} />
    </div>
  );
}
