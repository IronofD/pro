import React, { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OutpostScene } from "./Scene.jsx";
import {
  BatteryCharging, Bot, CheckCircle2, ChevronRight, CloudLightning,
  Droplets, Factory, FlaskConical, Leaf, Radio, Shield, Sun, Users,
  Wind, XCircle, Zap
} from "lucide-react";

const PLANETS = {
  Moon: {
    icon: "🌕",
    color: "#d7dce4",
    ground: "#777d88",
    description: "Learn the basics of power, life support and radiation protection.",
    challenge: "Long lunar night",
    missionDays: 12
  },
  Mars: {
    icon: "🔴",
    color: "#b65b3d",
    ground: "#9b4c36",
    description: "Handle dust storms, power limits and communication delay.",
    challenge: "Dust storm",
    missionDays: 12
  }
};

const INITIAL = {
  oxygen: 90,
  power: 85,
  food: 80,
  water: 78,
  shielding: 72,
  health: 92,
  science: 0
};

const BUILDINGS = {
  "Crew Habitat": { icon: Users, color: "#dfe7f2", cost: { power: 2 }, info: "Keeps the crew protected and supports life support." },
  Greenhouse: { icon: Leaf, color: "#48b77e", cost: { power: 5, water: 4 }, info: "Produces food, but needs electricity and water." },
  "Research Lab": { icon: FlaskConical, color: "#d8ad4f", cost: { power: 7 }, info: "Runs experiments and increases science score." },
  "Radiation Shelter": { icon: Shield, color: "#9b9eea", cost: { power: 3 }, info: "Reduces radiation exposure during solar events." },
  "Solar Power Station": { icon: Sun, color: "#3b86bd", cost: {}, info: "Generates power during normal sunlight conditions." },
  "Communication Tower": { icon: Radio, color: "#e5e5e5", cost: { power: 2 }, info: "Maintains contact with Earth; Mars has a simulated delay." }
};

const EVENTS = {
  Moon: [
    { title: "Solar activity alert", text: "A radiation event is approaching. Protecting the crew uses power, but ignoring it can reduce health.", choices: [
      { label: "Use radiation shelter", effects: { power: -8, health: 2, shielding: 3 }, result: "Crew sheltered safely. The shelter consumed extra power." },
      { label: "Continue research", effects: { health: -12, science: 8 }, result: "Research continued, but the crew received extra radiation exposure." }
    ]},
    { title: "Lunar night planning", text: "The long lunar night is coming. Save energy now or keep the greenhouse running.", choices: [
      { label: "Save power", effects: { power: 10, food: -5 }, result: "You conserved energy, but food production slowed." },
      { label: "Keep greenhouse active", effects: { power: -10, food: 10 }, result: "Food production stayed strong at the cost of stored power." }
    ]},
    { title: "Equipment check", text: "A life-support filter needs attention.", choices: [
      { label: "Repair immediately", effects: { power: -6, oxygen: 5 }, result: "The filter was repaired and oxygen efficiency improved." },
      { label: "Delay repair", effects: { oxygen: -12, science: 4 }, result: "The crew gained time for science, but oxygen reserves fell." }
    ]}
  ],
  Mars: [
    { title: "Dust storm warning", text: "A regional dust storm is reducing solar generation.", choices: [
      { label: "Enter shelter mode", effects: { power: -3, shielding: 2, health: 2 }, result: "The crew reduced outdoor exposure and protected systems." },
      { label: "Keep operations running", effects: { power: -14, science: 6 }, result: "You kept working, but solar power reserves dropped sharply." }
    ]},
    { title: "Earth communication delay", text: "A message from Earth will take time to arrive. Decide without immediate guidance.", choices: [
      { label: "Make the local decision", effects: { science: 7, health: -2 }, result: "The crew acted independently and completed the task." },
      { label: "Wait for Earth", effects: { power: -4, food: -4 }, result: "Waiting preserved certainty but consumed resources." }
    ]},
    { title: "Greenhouse maintenance", text: "Dust has reduced the greenhouse's efficiency.", choices: [
      { label: "Clean it now", effects: { power: -5, food: 12 }, result: "The greenhouse recovered and produced more food." },
      { label: "Postpone it", effects: { food: -10, power: 4 }, result: "You saved power now, but future food production fell." }
    ]}
  ]
};

function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

function Resource({ label, value, icon: Icon }) {
  return (
    <div className="resource">
      <div className="resource-head"><span><Icon size={15} /> {label}</span><strong>{value}%</strong></div>
      <div className="bar"><div style={{ width: `${value}%` }} /></div>
    </div>
  );
}

export default function App() {
  const [planet, setPlanet] = useState("Moon");
  const [started, setStarted] = useState(false);
  const [day, setDay] = useState(1);
  const [resources, setResources] = useState(INITIAL);
  const [selected, setSelected] = useState("");
  const [event, setEvent] = useState(null);
  const [message, setMessage] = useState("Choose a mission and become the commander of an outpost.");
  const [built, setBuilt] = useState(["Crew Habitat", "Greenhouse", "Solar Power Station", "Communication Tower"]);
  const [gameOver, setGameOver] = useState(false);
  const [victory, setVictory] = useState(false);
  const [weather, setWeather] = useState("clear");

  const currentPlanet = PLANETS[planet];
  function startMission(nextPlanet = planet) {
    setPlanet(nextPlanet);
    setStarted(true);
    setDay(1);
    setResources(INITIAL);
    setBuilt(["Crew Habitat", "Greenhouse", "Solar Power Station", "Communication Tower"]);
    setSelected("");
    setEvent(null);
    setGameOver(false);
    setVictory(false);
    setWeather("clear");
    setMessage(`Mission started on ${nextPlanet}. Keep the crew safe for ${PLANETS[nextPlanet].missionDays} days.`);
  }

  function updateEffects(effects) {
    setResources(prev => {
      const next = { ...prev };
      Object.entries(effects).forEach(([key, amount]) => {
        next[key] = clamp((next[key] ?? 0) + amount);
      });
      return next;
    });
  }

  function chooseEvent(choice) {
    updateEffects(choice.effects);
    setMessage(choice.result);
    setEvent(null);
  }

  function advanceDay() {
    if (gameOver || victory) return;
    const baseDrain = { oxygen: -5, power: -4, food: -3, water: -3 };
    if (planet === "Mars" && day % 4 === 0) baseDrain.power -= 3;
    if (built.includes("Greenhouse")) baseDrain.food += 2;
    if (built.includes("Solar Power Station")) baseDrain.power += 5;
    if (built.includes("Crew Habitat")) baseDrain.oxygen += 1;

    updateEffects(baseDrain);

    const nextDay = day + 1;
    if (nextDay > currentPlanet.missionDays) {
      setVictory(true);
      setMessage("Mission complete! Your crew survived the training mission.");
      return;
    }
    setDay(nextDay);
    setSelected("");
    const pool = EVENTS[planet];
    const nextEvent = pool[(nextDay - 1) % pool.length];
    setEvent(nextEvent);
    setWeather(nextEvent.title === "Dust storm warning" ? "storm" : nextEvent.title === "Solar activity alert" ? "flare" : "clear");
  }

  function interactBuilding(name) {
    setSelected(name);
    if (name === "Solar Power Station") {
      updateEffects({ power: 12 });
      setMessage("Solar station generated stored power.");
    } else if (name === "Greenhouse") {
      updateEffects({ food: 8, water: -4, power: -3 });
      setMessage("The greenhouse produced food, using water and power.");
    } else if (name === "Research Lab") {
      updateEffects({ science: 8, power: -6 });
      setMessage("Science experiment completed: +8 science, -6 power.");
    } else if (name === "Radiation Shelter") {
      updateEffects({ shielding: 5, power: -3 });
      setMessage("Shielding systems checked and reinforced.");
    } else if (name === "Communication Tower") {
      updateEffects({ power: -2 });
      setMessage(planet === "Mars" ? "Message sent to Earth. Mars communication has a delay." : "Communication link with Earth is healthy.");
    }
  }

  function build(name) {
    if (built.includes(name)) {
      setMessage(`${name} is already part of your outpost.`);
      return;
    }
    const cost = BUILDINGS[name].cost;
    const canBuild = Object.entries(cost).every(([k, v]) => (resources[k] ?? 0) >= v);
    if (!canBuild) {
      setMessage(`Not enough resources to build ${name}.`);
      return;
    }
    updateEffects(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, -v])));
    setBuilt(prev => [...prev, name]);
    setMessage(`${name} constructed. Every new system has an operating cost.`);
  }

  function reset() {
    setStarted(false);
    setGameOver(false);
    setVictory(false);
    setEvent(null);
    setMessage("Choose Moon or Mars to begin.");
  }

  const critical = Object.values({
    oxygen: resources.oxygen,
    power: resources.power,
    food: resources.food,
    water: resources.water,
    health: resources.health
  }).some(v => v <= 0);

  useEffect(() => {
    if (critical && started && !gameOver && !victory) {
      setGameOver(true);
    }
  }, [critical, started, gameOver, victory]);

  if (!started) {
    return (
      <div className="landing">
        <div className="landing-glow" />
        <div className="landing-card">
          <div className="eyebrow">NASA SPACE APPS • EDUCATIONAL SIMULATION</div>
          <h1>🚀 Junior Astronaut<br /><span>Mission Trainer</span></h1>
          <p>Run a lunar or Martian outpost. Balance life support, power, food, water and radiation protection. Every choice has a cost.</p>
          <div className="planet-select">
            {Object.entries(PLANETS).map(([name, data]) => (
              <button key={name} className={`planet-card ${planet === name ? "selected" : ""}`} onClick={() => setPlanet(name)}>
                <span className="planet-icon">{data.icon}</span>
                <span><b>{name}</b><small>{data.description}</small></span>
              </button>
            ))}
          </div>
          <button className="primary start" onClick={() => startMission(planet)}>Start Mission <ChevronRight /></button>
          <p className="disclaimer">Prototype values are simplified educational game mechanics. NASA data integrations are planned for the next development phase.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><div className="logo">🚀</div><div><b>Junior Astronaut</b><small>MISSION TRAINER</small></div></div>
        <div className="mission-pill">{currentPlanet.icon} {planet} OUTPOST <span>DAY {day}/{currentPlanet.missionDays}</span></div>
        <button className="ghost" onClick={reset}>Exit Mission</button>
      </header>

      <main className="game-grid">
        <section className="scene-card">
          <div className="scene-toolbar">
            <span>OUTPOST VIEW</span><span>Drag to rotate • Scroll to zoom • Click systems</span>
          </div>
          <div className="scene">
            <Canvas key={planet} shadows dpr={[1, 1.75]} camera={{ position: [9, 6.5, 10], fov: 42, near: 0.1, far: 500 }} gl={{ powerPreference: "high-performance" }}>
              <OutpostScene planet={planet} selected={selected} onSelect={interactBuilding} weather={weather} />
            </Canvas>
          </div>
          <div className="event-strip"><CloudLightning size={17} /><span>{message}</span></div>
        </section>

        <aside className="control-panel">
          <div className="panel-title"><span>MISSION CONTROL</span><span className="live">● LIVE</span></div>
          <div className="crew"><Users size={18} /><div><b>2 astronauts</b><small>Crew health {resources.health}%</small></div><div className="health-dot" /></div>

          <Resource label="Oxygen" value={resources.oxygen} icon={Wind} />
          <Resource label="Power" value={resources.power} icon={BatteryCharging} />
          <Resource label="Food" value={resources.food} icon={Leaf} />
          <Resource label="Water" value={resources.water} icon={Droplets} />
          <Resource label="Shielding" value={resources.shielding} icon={Shield} />

          <div className="science"><FlaskConical size={16} /><span>Science score</span><b>{resources.science}</b></div>

          <div className="selected-box">
            <div className="selected-title"><Factory size={17} /> Outpost systems</div>
            <div className="system-list">
              {Object.keys(BUILDINGS).map(name => {
                const Icon = BUILDINGS[name].icon;
                return (
                  <button key={name} className={built.includes(name) ? "system built" : "system"} onClick={() => built.includes(name) ? interactBuilding(name) : build(name)}>
                    <Icon size={15} /><span>{name}</span>{built.includes(name) ? <CheckCircle2 size={14} /> : <span className="build">BUILD</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <button className="primary next" onClick={advanceDay}>End Day & Continue <ChevronRight /></button>
          <div className="source-note">NASA data note: this prototype uses simplified mechanics. Real DONKI, OSDR/RadLab and planetary data should be connected and attributed before submission.</div>
        </aside>
      </main>

      {event && (
        <div className="modal-backdrop">
          <div className="event-modal">
            <button className="close" onClick={() => setEvent(null)}><XCircle /></button>
            <div className="event-icon"><CloudLightning /></div>
            <div className="eyebrow">MISSION EVENT • DAY {day}</div>
            <h2>{event.title}</h2>
            <p>{event.text}</p>
            <div className="choices">
              {event.choices.map((choice, i) => (
                <button key={i} onClick={() => chooseEvent(choice)} className="choice">
                  <b>{choice.label}</b><small>Make this decision</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {victory && (
        <div className="modal-backdrop">
          <div className="result-modal success">
            <CheckCircle2 size={52} />
            <div className="eyebrow">MISSION COMPLETE</div>
            <h2>Outstanding, Commander!</h2>
            <p>Your crew completed the {planet} training mission.</p>
            <div className="result-grid">
              <div><b>{resources.health}%</b><small>Crew health</small></div>
              <div><b>{resources.science}</b><small>Science</small></div>
              <div><b>{resources.power}%</b><small>Power left</small></div>
            </div>
            <button className="primary" onClick={() => startMission(planet)}>Play Again</button>
          </div>
        </div>
      )}

      {gameOver && !victory && (
        <div className="modal-backdrop">
          <div className="result-modal failure">
            <XCircle size={52} />
            <div className="eyebrow">MISSION ENDED</div>
            <h2>Mission needs a new plan.</h2>
            <p>A critical resource reached zero. Try a different strategy—the point is to learn from the trade-offs.</p>
            <button className="primary" onClick={() => startMission(planet)}>Try Again</button>
          </div>
        </div>
      )}
    </div>
  );
}