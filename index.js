// ===============================================================================================
// ==                                    SERVER-SIDE CODE                                       ==
// ===============================================================================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Startovní pozice pro všechny hráče
const START_POSITION = { x: 0, y: 5, z: 0 };

let players = {};

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('joinGame', (playerName) => {
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            position: START_POSITION,
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
        };
        console.log(`Player ${playerName} (${socket.id}) joined.`);

        socket.emit('currentState', players);
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('playerMove', (playerData) => {
        if (players[socket.id]) {
            players[socket.id].position = playerData.position;
            players[socket.id].quaternion = playerData.quaternion;
        }
    });

    socket.on('disconnect', () => {
        if(players[socket.id]){
            console.log(`Player ${players[socket.id].name} (${socket.id}) disconnected.`);
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
        }
    });
});

setInterval(() => {
    io.emit('gameStateUpdate', players);
}, 1000 / 30);

app.get('/', (req, res) => {
    res.send(generateHTML());
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

function generateHTML() {
    return `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Platformer - Step 1</title>
    <style>
        body { margin: 0; overflow: hidden; background-color: #000; }
        canvas { display: block; }
        #login-screen {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.7); display: flex;
            justify-content: center; align-items: center; flex-direction: column; z-index: 10;
        }
        #login-screen h1 { color: white; font-family: sans-serif; }
        #login-screen input { padding: 10px; font-size: 16px; margin-bottom: 10px; }
        #login-screen button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
    </style>
    <!-- Načtení knihoven z CDN -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cannon-es@0.19.0/dist/cannon-es.min.js"></script>
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
    <script src="https://unpkg.com/three@0.128.0/examples/js/renderers/CSS2DRenderer.js"></script>
</head>
<body>
    <div id="login-screen">
        <h1>Zadej své jméno</h1>
        <input type="text" id="playerNameInput" placeholder="Jméno hráče" maxlength="15">
        <button id="playButton">Hrát</button>
    </div>

    <script>
// ===============================================================================================
// ==                                     CLIENT-SIDE CODE                                      ==
// ===============================================================================================

// Globální proměnné pro hru
let scene, camera, renderer, labelRenderer, world;
let localPlayer = {};
let players = {};
const keysPressed = {};
const socket = io();

// UI Elementy
const loginScreen = document.getElementById('login-screen');
const playerNameInput = document.getElementById('playerNameInput');
const playButton = document.getElementById('playButton');

// --- Logika pro připojení do hry ---
playButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        loginScreen.style.display = 'none'; // Schováme jen přihlašovací okno
        socket.emit('joinGame', playerName); // Pošleme jméno na server
    }
});

// --- Inicializace 3D světa ---
function init() {
    // Fyzikální svět
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

    // Scéna
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Nebesky modrá

    // Kamera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Renderer pro jmenovky
    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    document.body.appendChild(labelRenderer.domElement);
    
    // Osvětlení
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 30, 10);
    scene.add(dirLight);

    // Vytvoření startovní platformy
    createStartPlatform();

    // Sledování stisku kláves
    document.addEventListener('keydown', (e) => { keysPressed[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', (e) => { keysPressed[e.key.toLowerCase()] = false; });
    window.addEventListener('resize', onWindowResize, false);
    
    animate();
}

function createStartPlatform() {
    // Fyzikální těleso platformy
    const platformBody = new CANNON.Body({
        mass: 0, // Statický objekt
        shape: new CANNON.Box(new CANNON.Vec3(10, 0.5, 10)),
        position: new CANNON.Vec3(0, -0.5, 0),
    });
    world.addBody(platformBody);
    
    // Vizuální model platformy
    const platformGeometry = new THREE.BoxGeometry(20, 1, 20);
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x4CAF50 });
    const platformMesh = new THREE.Mesh(platformGeometry, platformMaterial);
    platformMesh.position.copy(platformBody.position);
    scene.add(platformMesh);
}

// Funkce pro vytvoření postavy hráče (nyní kostka)
function createPlayer(playerInfo) {
    const isLocal = playerInfo.id === socket.id;
    const color = isLocal ? 0xff4500 : 0x1e90ff; // Oranžová pro lokálního, modrá pro ostatní
    
    // Vizuální model (kostka)
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: color })
    );
    scene.add(mesh);

    // Fyzikální těleso (kostka)
    const body = new CANNON.Body({
        mass: 5,
        shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), // Poloviční rozměry
        position: new CANNON.Vec3(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z),
        angularDamping: 1.0 // DŮLEŽITÉ: Zabrání kostce, aby se převracela
    });
    world.addBody(body);

    // Jmenovka nad hráčem
    const nameDiv = document.createElement('div');
    nameDiv.textContent = playerInfo.name;
    nameDiv.style.color = 'white';
    nameDiv.style.fontFamily = 'sans-serif';
    nameDiv.style.textShadow = '1px 1px 2px black';
    
    const nameLabel = new THREE.CSS2DObject(nameDiv);
    nameLabel.position.set(0, 0.8, 0); // Trochu nad kostkou
    mesh.add(nameLabel);

    const playerObject = { id: playerInfo.id, mesh, body, name: playerInfo.name };
    
    if (isLocal) {
        localPlayer = playerObject;
    } else {
        players[playerInfo.id] = playerObject;
    }
}

// --- Komunikace se serverem ---
socket.on('currentState', (serverPlayers) => {
    Object.values(serverPlayers).forEach(p => createPlayer(p));
});

socket.on('newPlayer', (playerInfo) => {
    if (!players[playerInfo.id] && playerInfo.id !== socket.id) {
        createPlayer(playerInfo);
    }
});

socket.on('playerLeft', (playerId) => {
    if (players[playerId]) {
        scene.remove(players[playerId].mesh);
        world.removeBody(players[playerId].body);
        delete players[playerId];
    }
});

socket.on('gameStateUpdate', (serverPlayers) => {
    Object.values(serverPlayers).forEach(playerInfo => {
        if (playerInfo.id !== socket.id && players[playerInfo.id]) {
            players[playerInfo.id].body.position.lerp(playerInfo.position, 0.2);
            players[playerInfo.id].body.quaternion.slerp(playerInfo.quaternion, 0.2);
        }
    });
});

// --- Herní smyčka a ovládání ---
let lastUpdateTime = 0;
function animate(time) {
    requestAnimationFrame(animate);

    const deltaTime = (time - (lastUpdateTime || time)) / 1000;
    lastUpdateTime = time;

    world.step(1/60, deltaTime, 3);
    
    if (localPlayer.body) {
        handleControls();
        localPlayer.mesh.position.copy(localPlayer.body.position);
        localPlayer.mesh.quaternion.copy(localPlayer.body.quaternion);

        socket.emit('playerMove', {
            position: localPlayer.body.position,
            quaternion: localPlayer.body.quaternion,
        });

        // Kamera sleduje hráče
        const cameraOffset = new THREE.Vector3(0, 4, 8);
        const playerPosition = localPlayer.mesh.position.clone();
        camera.position.lerp(playerPosition.add(cameraOffset), 0.1);
        camera.lookAt(localPlayer.mesh.position);
    }

    Object.values(players).forEach(p => {
        p.mesh.position.copy(p.body.position);
        p.mesh.quaternion.copy(p.body.quaternion);
    });
    
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

function handleControls() {
    const speed = 5;
    const jumpForce = 7;
    
    if (keysPressed['w']) localPlayer.body.velocity.z = -speed;
    else if (keysPressed['s']) localPlayer.body.velocity.z = speed;
    else localPlayer.body.velocity.z = 0;

    if (keysPressed['a']) localPlayer.body.velocity.x = -speed;
    else if (keysPressed['d']) localPlayer.body.velocity.x = speed;
    else localPlayer.body.velocity.x = 0;
    
    // Skok - povolíme jen když je hráč téměř v klidu na ose Y
    if (keysPressed[' '] && Math.abs(localPlayer.body.velocity.y) < 0.1) {
        localPlayer.body.velocity.y = jumpForce;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// Inicializujeme hru okamžitě po načtení stránky
init();

    </script>
</body>
</html>
    `;
}