import * as THREE from 'three';

const SLOT_COUNT = 8;
const COLS = 4;
const ROWS = 2;
const SLOT_SPACING = 3.2;

const CAT_COLORS = {
  tabby: 0xf97316,
  siamese: 0xe7e5e4,
  persian: 0xa78bfa,
  maine: 0x78716c,
  shadow: 0x1e1b4b,
};

export class GameWorld3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.onPadClick = null;
    this.slotMeshes = [];
    this.otherBases = new Map();
    
    // Player movement
    this.playerPosition = new THREE.Vector3(0, 0, 8);
    this.playerRotation = 0;
    this.playerVelocity = new THREE.Vector3();
    this.keys = { w: false, a: false, s: false, d: false, space: false };
    this.playerSpeed = 0.15;
    this.rotationSpeed = 0.05;
    
    // Jump physics (Roblox-like)
    this.isGrounded = true;
    this.jumpVelocity = 0;
    this.gravity = -0.015;
    this.jumpForce = 0.35;
    this.groundY = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1116);
    this.scene.fog = new THREE.Fog(0x0f1116, 20, 80);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );
    
    // Third-person camera setup - back-looking view
    this.cameraOffset = new THREE.Vector3(0, 5, -10);
    this.cameraLookOffset = new THREE.Vector3(0, 2, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;

    this._setupLights();
    this._buildEnvironment();
    this._buildPlayerBase(0, 0, true);
    this._buildPlayerCharacter();
    this._setupControls();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    canvas.addEventListener('pointerdown', (e) => this._onPointer(e));

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x404060, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);
    const fill = new THREE.PointLight(0x3b82f6, 0.35, 40);
    fill.position.set(-6, 6, -4);
    this.scene.add(fill);
  }

  _setupControls() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys.hasOwnProperty(key)) {
        this.keys[key] = true;
      }
      if (e.code === 'Space') {
        this.keys.space = true;
      }
    });
    
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys.hasOwnProperty(key)) {
        this.keys[key] = false;
      }
      if (e.code === 'Space') {
        this.keys.space = false;
      }
    });
  }

  _buildPlayerCharacter() {
    // Create a simple blocky player character (Roblox-style)
    this.playerGroup = new THREE.Group();
    
    // Body
    const bodyGeo = new THREE.BoxGeometry(1, 1.5, 0.6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.75;
    body.castShadow = true;
    this.playerGroup.add(body);
    
    // Head
    const headGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfcd34d });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.9;
    head.castShadow = true;
    this.playerGroup.add(head);
    
    // Arms
    const armGeo = new THREE.BoxGeometry(0.3, 1, 0.3);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
    
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.65, 0.8, 0);
    leftArm.castShadow = true;
    this.playerGroup.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.65, 0.8, 0);
    rightArm.castShadow = true;
    this.playerGroup.add(rightArm);
    
    // Legs
    const legGeo = new THREE.BoxGeometry(0.35, 0.8, 0.35);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f });
    
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.25, -0.4, 0);
    leftLeg.castShadow = true;
    this.playerGroup.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.25, -0.4, 0);
    rightLeg.castShadow = true;
    this.playerGroup.add(rightLeg);
    
    this.playerGroup.position.copy(this.playerPosition);
    this.scene.add(this.playerGroup);
  }

  _updatePlayerMovement() {
    // Calculate movement direction based on player rotation
    const moveDirection = new THREE.Vector3();
    
    if (this.keys.w) moveDirection.z += 1;
    if (this.keys.s) moveDirection.z -= 1;
    if (this.keys.a) moveDirection.x += 1;
    if (this.keys.d) moveDirection.x -= 1;
    
    if (moveDirection.length() > 0) {
      moveDirection.normalize();
      
      // Rotate movement direction by player rotation
      const rotatedX = moveDirection.x * Math.cos(this.playerRotation) - moveDirection.z * Math.sin(this.playerRotation);
      const rotatedZ = moveDirection.x * Math.sin(this.playerRotation) + moveDirection.z * Math.cos(this.playerRotation);
      
      this.playerVelocity.x = rotatedX * this.playerSpeed;
      this.playerVelocity.z = rotatedZ * this.playerSpeed;
      
      // Rotate player towards movement direction
      if (this.keys.w || this.keys.s || this.keys.a || this.keys.d) {
        const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
        this.playerRotation = targetRotation;
      }
    } else {
      this.playerVelocity.x *= 0.9; // Friction
      this.playerVelocity.z *= 0.9;
    }
    
    // Apply horizontal velocity
    this.playerPosition.x += this.playerVelocity.x;
    this.playerPosition.z += this.playerVelocity.z;
    
    // Jump physics
    if (this.keys.space && this.isGrounded) {
      this.jumpVelocity = this.jumpForce;
      this.isGrounded = false;
    }
    
    // Apply gravity
    this.jumpVelocity += this.gravity;
    this.playerPosition.y += this.jumpVelocity;
    
    // Ground detection
    if (this.playerPosition.y <= this.groundY) {
      this.playerPosition.y = this.groundY;
      this.jumpVelocity = 0;
      this.isGrounded = true;
    }
    
    // Clamp position to map bounds
    this.playerPosition.x = Math.max(-35, Math.min(35, this.playerPosition.x));
    this.playerPosition.z = Math.max(-35, Math.min(35, this.playerPosition.z));
    
    // Update player group position and rotation
    this.playerGroup.position.copy(this.playerPosition);
    this.playerGroup.rotation.y = this.playerRotation;
  }

  _updateCamera() {
    // Calculate camera position behind player
    const cameraOffset = this.cameraOffset.clone();
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.playerRotation);
    
    this.camera.position.copy(this.playerPosition).add(cameraOffset);
    
    // Look at player
    const lookTarget = this.playerPosition.clone().add(this.cameraLookOffset);
    this.camera.lookAt(lookTarget);
  }

  _buildEnvironment() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0x12151c, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(80, 80, 0x2a3140, 0x1a1f28);
    grid.position.y = 0.01;
    this.scene.add(grid);
    
    // Add some decorative elements
    this._addDecorations();
  }
  
  _addDecorations() {
    // Add some random structures around the map
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() - 0.5) * 70;
      const z = (Math.random() - 0.5) * 70;
      
      // Avoid center area where player starts
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;
      
      const height = 2 + Math.random() * 4;
      const width = 2 + Math.random() * 3;
      
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, width),
        new THREE.MeshStandardMaterial({ 
          color: 0x1a1f28,
          roughness: 0.8
        })
      );
      building.position.set(x, height / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;
      this.scene.add(building);
    }
  }

  _buildPlayerBase(offsetX, offsetZ, isSelf) {
    const group = new THREE.Group();
    // Position base relative to world, not player
    group.position.set(offsetX, 0, offsetZ);

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(COLS * SLOT_SPACING + 1, 0.4, ROWS * SLOT_SPACING + 1),
      new THREE.MeshStandardMaterial({
        color: isSelf ? 0x1e3a5f : 0x1a1f28,
        roughness: 0.7,
      })
    );
    platform.position.y = 0.2;
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);

    const label = this._makeLabel(isSelf ? 'Your Base' : 'Player');
    label.position.set(0, 3.2, -ROWS * SLOT_SPACING * 0.5);
    group.add(label);
    group.userData.label = label;

    const slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = (col - (COLS - 1) / 2) * SLOT_SPACING;
      const z = row * SLOT_SPACING + 1;
      const slotGroup = this._createSlot(i, x, z);
      group.add(slotGroup.root);
      slots.push(slotGroup);
    }

    this.scene.add(group);
    return { group, slots, label };
  }

  _createSlot(index, x, z) {
    const root = new THREE.Group();
    root.position.set(x, 0.4, z);

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.15, 1.4),
      new THREE.MeshStandardMaterial({
        color: 0x166534,
        emissive: 0x14532d,
        emissiveIntensity: 0.4,
        roughness: 0.5,
      })
    );
    pad.position.set(0, 0.1, 1.1);
    pad.castShadow = true;
    pad.receiveShadow = true;
    pad.userData = { type: 'pad', slotIndex: index };

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1, 0.5, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a3140 })
    );
    pedestal.position.y = 0.45;
    pedestal.castShadow = true;

    const catGroup = new THREE.Group();
    catGroup.position.y = 0.85;
    catGroup.visible = false;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.6, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xf97316 })
    );
    body.position.y = 0.35;
    body.castShadow = true;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xf97316 })
    );
    head.position.set(0, 0.85, 0.35);
    head.castShadow = true;

    const earGeo = new THREE.ConeGeometry(0.12, 0.22, 4);
    const earMat = new THREE.MeshStandardMaterial({ color: 0xea580c });
    const earL = new THREE.Mesh(earGeo, earMat);
    earL.position.set(-0.2, 1.1, 0.35);
    const earR = earL.clone();
    earR.position.x = 0.2;
    catGroup.add(body, head, earL, earR);

    const padLabel = this._makeLabel('$0', 0.35);
    padLabel.position.set(0, 0.55, 1.1);
    root.add(pad, pedestal, catGroup, padLabel);

    return {
      root,
      pad,
      catGroup,
      bodyMat: body.material,
      headMat: head.material,
      earMat,
      padMat: pad.material,
      padLabel,
    };
  }

  _makeLabel(text, scale = 0.5) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15,17,22,0.85)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#e8eaed';
    ctx.font = 'bold 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 42);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4 * scale, 1 * scale, 1);
    sprite.userData.canvas = canvas;
    sprite.userData.ctx = ctx;
    sprite.userData.tex = tex;
    return sprite;
  }

  _setSpriteText(sprite, text) {
    const { canvas, ctx, tex } = sprite.userData;
    ctx.fillStyle = 'rgba(15,17,22,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8eaed';
    ctx.font = 'bold 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 42);
    tex.needsUpdate = true;
  }

  _setCatColor(slot, type) {
    const hex = CAT_COLORS[type] || CAT_COLORS.tabby;
    slot.bodyMat.color.setHex(hex);
    slot.headMat.color.setHex(hex);
    slot.earMat.color.setHex(hex);
    const darker = new THREE.Color(hex).multiplyScalar(0.75);
    slot.earMat.color.copy(darker);
  }

  updateSelf(player) {
    if (!this.selfBase) {
      // Position player's base at a fixed location in the world
      this.selfBase = this._buildPlayerBase(0, 0, true);
      this.slotMeshes = this.selfBase.slots;
    }

    const pads = player.padBalances || [];
    const cats = player.cats || [];

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = this.slotMeshes[i];
      if (!slot) continue;

      const catData = cats[i]?.cat;
      const padBal = pads[i] ?? cats[i]?.padBalance ?? 0;

      slot.catGroup.visible = !!catData;
      if (catData) this._setCatColor(slot, catData.type);

      const hasMoney = padBal > 0;
      slot.padMat.emissive.setHex(hasMoney ? 0x22c55e : 0x14532d);
      slot.padMat.emissiveIntensity = hasMoney ? 0.9 : 0.35;

      this._setSpriteText(
        slot.padLabel,
        hasMoney ? `$${Math.floor(padBal)}` : 'PAD'
      );
    }
  }

  updateOthers(players, selfUsername) {
    const others = players.filter(
      (p) => p.username.toLowerCase() !== selfUsername?.toLowerCase()
    );

    const seen = new Set();
    others.forEach((p, idx) => {
      seen.add(p.username);
      const angle = (idx / Math.max(others.length, 1)) * Math.PI * 2;
      const radius = 14;
      const ox = Math.cos(angle) * radius;
      const oz = Math.sin(angle) * radius + 8;

      if (!this.otherBases.has(p.username)) {
        const base = this._buildPlayerBase(ox, oz, false);
        this._setSpriteText(base.label, p.username);
        this.otherBases.set(p.username, base);
      }

      const base = this.otherBases.get(p.username);
      base.group.position.set(ox, 0, oz);

      const pads = p.padBalances || [];
      const cats = p.cats || [];
      base.slots.forEach((slot, i) => {
        const catData = cats[i]?.cat;
        const padBal = pads[i] ?? 0;
        slot.catGroup.visible = !!catData;
        if (catData) this._setCatColor(slot, catData.type);
        slot.padMat.emissiveIntensity = padBal > 0 ? 0.7 : 0.2;
      });
    });

    for (const [name, base] of this.otherBases) {
      if (!seen.has(name)) {
        this.scene.remove(base.group);
        this.otherBases.delete(name);
      }
    }
  }

  _onPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.slotMeshes.map((s) => s.pad);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length && hits[0].object.userData.type === 'pad') {
      const idx = hits[0].object.userData.slotIndex;
      this.onPadClick?.(idx);
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    
    // Update player movement and camera
    this._updatePlayerMovement();
    this._updateCamera();
    
    // Animate cats
    const t = performance.now() * 0.001;
    this.slotMeshes.forEach((s, i) => {
      if (s.catGroup.visible) {
        s.catGroup.position.y = 0.85 + Math.sin(t * 2 + i) * 0.05;
      }
    });
    
    // Animate player character (simple bobbing when moving)
    if (this.playerVelocity.length() > 0.01) {
      this.playerGroup.position.y = this.playerPosition.y + Math.sin(t * 10) * 0.05;
    } else {
      this.playerGroup.position.y = this.playerPosition.y;
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
