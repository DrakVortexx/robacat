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
    this.playerSpeed = 0.08;
    this.rotationSpeed = 0.05;
    
    // Mouse look
    this.mouseSensitivity = 0.002;
    this.cameraPitch = 0;
    this.isPointerLocked = false;
    
    // Jump physics (Roblox-like)
    this.isGrounded = true;
    this.jumpVelocity = 0;
    this.gravity = -0.015;
    this.jumpForce = 0.35;
    this.groundY = 0;
    
    // Particle system
    this.particles = [];
    
    // Collision objects
    this.colliders = [];

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1f2e);
    this.scene.fog = new THREE.Fog(0x1a1f2e, 30, 120);

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
    this.scene.add(new THREE.AmbientLight(0x606080, 0.8));
    const sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sun.position.set(15, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 100;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    this.scene.add(sun);
    const fill = new THREE.PointLight(0x4a90d9, 0.5, 50);
    fill.position.set(-10, 10, -10);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xff6b35, 0.3, 40);
    rim.position.set(15, 8, -15);
    this.scene.add(rim);
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
    
    // Pointer lock for mouse look
    this.canvas.addEventListener('click', () => {
      this.canvas.requestPointerLock();
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.isPointerLocked) {
        this.playerRotation -= e.movementX * this.mouseSensitivity;
        this.cameraPitch -= e.movementY * this.mouseSensitivity;
        this.cameraPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.cameraPitch));
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
    // Calculate movement direction relative to camera
    const moveDirection = new THREE.Vector3();
    
    if (this.keys.w) moveDirection.z += 1;
    if (this.keys.s) moveDirection.z -= 1;
    if (this.keys.a) moveDirection.x += 1;
    if (this.keys.d) moveDirection.x -= 1;
    
    if (moveDirection.length() > 0) {
      moveDirection.normalize();
      
      // Rotate movement direction by player rotation (controlled by mouse)
      const rotatedX = moveDirection.x * Math.cos(this.playerRotation) - moveDirection.z * Math.sin(this.playerRotation);
      const rotatedZ = moveDirection.x * Math.sin(this.playerRotation) + moveDirection.z * Math.cos(this.playerRotation);
      
      this.playerVelocity.x = rotatedX * this.playerSpeed;
      this.playerVelocity.z = rotatedZ * this.playerSpeed;
    } else {
      this.playerVelocity.x *= 0.9; // Friction
      this.playerVelocity.z *= 0.9;
    }
    
    // Apply horizontal velocity with collision detection
    const newX = this.playerPosition.x + this.playerVelocity.x;
    const newZ = this.playerPosition.z + this.playerVelocity.z;
    
    // Check X movement collision
    if (!this._checkCollision(newX, this.playerPosition.z)) {
      this.playerPosition.x = newX;
    }
    
    // Check Z movement collision
    if (!this._checkCollision(this.playerPosition.x, newZ)) {
      this.playerPosition.z = newZ;
    }
    
    // Jump physics
    const wasGrounded = this.isGrounded;
    if (this.keys.space && this.isGrounded) {
      this.jumpVelocity = this.jumpForce;
      this.isGrounded = false;
      this._createJumpParticles();
    }
    
    // Apply gravity
    this.jumpVelocity += this.gravity;
    this.playerPosition.y += this.jumpVelocity;
    
    // Ground detection
    if (this.playerPosition.y <= this.groundY) {
      this.playerPosition.y = this.groundY;
      this.jumpVelocity = 0;
      if (!wasGrounded) {
        this._createLandParticles();
      }
      this.isGrounded = true;
    }
    
    // Clamp position to map bounds
    this.playerPosition.x = Math.max(-35, Math.min(35, this.playerPosition.x));
    this.playerPosition.z = Math.max(-35, Math.min(35, this.playerPosition.z));
    
    // Update player group position and rotation
    this.playerGroup.position.copy(this.playerPosition);
    this.playerGroup.rotation.y = this.playerRotation;
  }
  
  _checkCollision(x, z) {
    const playerRadius = 0.5;
    
    for (const collider of this.colliders) {
      const halfWidth = collider.width / 2 + playerRadius;
      const halfDepth = collider.depth / 2 + playerRadius;
      
      if (x > collider.position.x - halfWidth &&
          x < collider.position.x + halfWidth &&
          z > collider.position.z - halfDepth &&
          z < collider.position.z + halfDepth) {
        return true;
      }
    }
    return false;
  }

  _updateCamera() {
    // Calculate camera position behind player with mouse look
    const cameraOffset = this.cameraOffset.clone();
    
    // Apply horizontal rotation (yaw)
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.playerRotation);
    
    // Apply vertical rotation (pitch)
    const pitchAxis = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.playerRotation);
    cameraOffset.applyAxisAngle(pitchAxis, this.cameraPitch);
    
    this.camera.position.copy(this.playerPosition).add(cameraOffset);
    
    // Look at player with vertical offset based on pitch
    const lookTarget = this.playerPosition.clone();
    lookTarget.y += 2 + Math.sin(this.cameraPitch) * 3;
    this.camera.lookAt(lookTarget);
  }
  
  _createJumpParticles() {
    const particleCount = 15;
    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.SphereGeometry(0.08, 8, 8);
      const material = new THREE.MeshBasicMaterial({ 
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.8
      });
      const particle = new THREE.Mesh(geometry, material);
      
      // Position at player's feet
      particle.position.copy(this.playerPosition);
      particle.position.y = 0.1;
      
      // Random spread
      particle.position.x += (Math.random() - 0.5) * 0.8;
      particle.position.z += (Math.random() - 0.5) * 0.8;
      
      // Velocity
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.05,
        Math.random() * 0.1 + 0.05,
        (Math.random() - 0.5) * 0.05
      );
      
      this.scene.add(particle);
      this.particles.push({ mesh: particle, velocity, life: 1.0 });
    }
  }
  
  _createLandParticles() {
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.SphereGeometry(0.1, 8, 8);
      const material = new THREE.MeshBasicMaterial({ 
        color: 0x888888,
        transparent: true,
        opacity: 0.9
      });
      const particle = new THREE.Mesh(geometry, material);
      
      // Position at player's feet
      particle.position.copy(this.playerPosition);
      particle.position.y = 0.05;
      
      // Random spread
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.6;
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;
      
      // Velocity - outward burst
      const velocity = new THREE.Vector3(
        Math.cos(angle) * (Math.random() * 0.08 + 0.02),
        Math.random() * 0.15 + 0.05,
        Math.sin(angle) * (Math.random() * 0.08 + 0.02)
      );
      
      this.scene.add(particle);
      this.particles.push({ mesh: particle, velocity, life: 1.0 });
    }
  }
  
  _updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= 0.03;
      
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      
      // Update position
      p.mesh.position.add(p.velocity);
      p.velocity.y -= 0.005; // Gravity on particles
      
      // Bounce off ground
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.velocity.y *= -0.3;
        p.velocity.x *= 0.7;
        p.velocity.z *= 0.7;
      }
      
      // Fade out
      p.mesh.material.opacity = p.life * 0.8;
      p.mesh.scale.setScalar(p.life);
    }
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
    // Add varied structures around the map
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() - 0.5) * 70;
      const z = (Math.random() - 0.5) * 70;
      
      // Avoid center area where player starts
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;
      
      const type = Math.random();
      
      if (type < 0.5) {
        // Tall buildings
        const height = 3 + Math.random() * 6;
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
        
        this.colliders.push({
          position: new THREE.Vector3(x, 0, z),
          width: width,
          depth: width,
          height: height
        });
      } else if (type < 0.75) {
        // Low platforms/ramps
        const width = 3 + Math.random() * 4;
        const height = 0.5 + Math.random() * 1;
        
        const platform = new THREE.Mesh(
          new THREE.BoxGeometry(width, height, width),
          new THREE.MeshStandardMaterial({ 
            color: 0x2a3140,
            roughness: 0.7
          })
        );
        platform.position.set(x, height / 2, z);
        platform.castShadow = true;
        platform.receiveShadow = true;
        this.scene.add(platform);
        
        this.colliders.push({
          position: new THREE.Vector3(x, 0, z),
          width: width,
          depth: width,
          height: height
        });
      } else {
        // Pillars/columns
        const height = 4 + Math.random() * 3;
        const radius = 0.5 + Math.random() * 0.5;
        
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, height, 8),
          new THREE.MeshStandardMaterial({ 
            color: 0x252a35,
            roughness: 0.6
          })
        );
        pillar.position.set(x, height / 2, z);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        this.scene.add(pillar);
        
        this.colliders.push({
          position: new THREE.Vector3(x, 0, z),
          width: radius * 2,
          depth: radius * 2,
          height: height
        });
      }
    }
    
    // Add some glowing orbs for atmosphere
    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 60;
      const z = (Math.random() - 0.5) * 60;
      
      if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;
      
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 16, 16),
        new THREE.MeshBasicMaterial({ 
          color: Math.random() > 0.5 ? 0x3b82f6 : 0x8b5cf6,
          transparent: true,
          opacity: 0.8
        })
      );
      orb.position.set(x, 1.5 + Math.random() * 2, z);
      this.scene.add(orb);
      
      // Add point light to orb
      const light = new THREE.PointLight(
        Math.random() > 0.5 ? 0x3b82f6 : 0x8b5cf6,
        0.5,
        8
      );
      light.position.copy(orb.position);
      this.scene.add(light);
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
    
    // Update particles
    this._updateParticles();
    
    // Animate cats
    const t = performance.now() * 0.001;
    this.slotMeshes.forEach((s, i) => {
      if (s.catGroup.visible) {
        s.catGroup.position.y = 0.85 + Math.sin(t * 2 + i) * 0.05;
      }
    });
    
    // Animate player character (walking animation)
    const isMoving = this.playerVelocity.length() > 0.01;
    if (isMoving) {
      // Bobbing motion
      this.playerGroup.position.y = this.playerPosition.y + Math.abs(Math.sin(t * 8)) * 0.08;
      
      // Arm and leg swinging
      const swingAmount = Math.sin(t * 8) * 0.4;
      this.playerGroup.children.forEach((child, index) => {
        // Left arm (index 2), right arm (index 3), left leg (index 4), right leg (index 5)
        if (index === 2 || index === 5) {
          child.rotation.x = swingAmount;
        } else if (index === 3 || index === 4) {
          child.rotation.x = -swingAmount;
        }
      });
    } else {
      this.playerGroup.position.y = this.playerPosition.y;
      // Reset limb rotations
      this.playerGroup.children.forEach((child) => {
        child.rotation.x = 0;
      });
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
