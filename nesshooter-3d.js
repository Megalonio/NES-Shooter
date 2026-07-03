// NESSHOOTER 3D Addon — Daggerfall-style true-3D first-person view.
// Optional: only loaded/used if this script tag is present. Exposes
// window.NesShooter3D.init(deps) -> { update(dt), render() }
(function(){
  function init(deps){
    const {
      ctx, canvas, player, MAP, ROWS, COLS, TILE, W, H,
      aimTouch, mouse, keys, moveTouch,
      resolveObstacles, isIndoors, drawTopHud
    } = deps;

    let fpsPitch = 0;
    const FPS_TURN_SPEED = 2.6;
    const FPS_PITCH_SPEED = 140;
    const FPS_PITCH_MAX = 50;
    const FPS_MOUSE_SENS = 0.003;
    const WALL_H = TILE, EYE_Z = TILE*0.5, FOCAL = 280;

    const FPS_WALL_COLOR  = { '#':[132,130,140], 'T':[46,120,52] };
    const FPS_FLOOR_COLOR = { grass:[54,132,58], sand:[198,182,138], wood:[120,84,52], water:[40,90,170] };

    function fpsFloorColorAt(x,y){
      if(isIndoors(x,y)) return FPS_FLOOR_COLOR.wood;
      const c = Math.floor(x/TILE), r = Math.floor(y/TILE);
      if(r<0||r>=ROWS||c<0||c>=COLS) return FPS_FLOOR_COLOR.grass;
      const ch = MAP[r][c];
      if(ch==='~') return FPS_FLOOR_COLOR.water;
      if(ch==='S') return FPS_FLOOR_COLOR.sand;
      return FPS_FLOOR_COLOR.grass;
    }

    function update(dt){
      player.angle += aimTouch.dx * FPS_TURN_SPEED * dt;
      player.angle += (mouse.mdx||0) * FPS_MOUSE_SENS;
      fpsPitch -= (mouse.mdy||0) * 0.5;
      mouse.mdx = 0; mouse.mdy = 0;
      if(aimTouch.active){
        fpsPitch -= aimTouch.dy * FPS_PITCH_SPEED * dt;
      }
      fpsPitch = Math.max(-FPS_PITCH_MAX, Math.min(FPS_PITCH_MAX, fpsPitch));
      let strafe = moveTouch.dx, forward = -moveTouch.dy;
      if(keys['w']||keys['z']||keys['arrowup']) forward += 1;
      if(keys['s']||keys['arrowdown']) forward -= 1;
      if(keys['d']||keys['arrowright']) strafe += 1;
      if(keys['a']||keys['q']||keys['arrowleft']) strafe -= 1;
      const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
      const rx = -fy, ry = fx;
      player.x += (fx*forward + rx*strafe) * player.speed * dt;
      player.y += (fy*forward + ry*strafe) * player.speed * dt;
      resolveObstacles(player);
    }

    function render(){
      const horizon = H/2 + fpsPitch;
      ctx.fillStyle = '#26262e'; ctx.fillRect(0,0,W,H); // ceiling
      const FOV = Math.PI/3, MAX_DIST = TILE*20, FLOOR_STEP = 3;
      for(let i=0;i<W;i++){
        const rayAngle = player.angle - FOV/2 + FOV*(i/W);
        const dxr = Math.cos(rayAngle), dyr = Math.sin(rayAngle);
        const cosOff = Math.cos(rayAngle-player.angle);
        for(let y=Math.max(horizon,0); y<H; y+=FLOOR_STEP){
          const rowDist = (TILE*H*0.5) / ((y-horizon)*cosOff);
          if(rowDist<=0 || rowDist>MAX_DIST) continue;
          const base = fpsFloorColorAt(player.x+dxr*rowDist, player.y+dyr*rowDist);
          const shade = Math.max(0.2, 1-rowDist/MAX_DIST);
          ctx.fillStyle = `rgb(${base[0]*shade|0},${base[1]*shade|0},${base[2]*shade|0})`;
          ctx.fillRect(i,y,1,FLOOR_STEP);
        }
      }

      const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
      const rx = -fy, ry = fx;
      function project(wx,wy,wz){
        const dxw = wx-player.x, dyw = wy-player.y;
        const depth = dxw*fx + dyw*fy;
        const horizd = dxw*rx + dyw*ry;
        if(depth < 0.15) return null;
        return { x: W/2 + (horizd/depth)*FOCAL, y: horizon - ((wz-EYE_Z)/depth)*FOCAL, depth };
      }

      const RADIUS = 12;
      const pc = Math.floor(player.x/TILE), pr = Math.floor(player.y/TILE);
      const faces = [];
      for(let r=pr-RADIUS;r<=pr+RADIUS;r++){
        for(let c=pc-RADIUS;c<=pc+RADIUS;c++){
          if(r<0||r>=ROWS||c<0||c>=COLS) continue;
          const ch = MAP[r][c];
          if(ch!=='#' && ch!=='T') continue;
          const wx0=c*TILE, wy0=r*TILE, wx1=wx0+TILE, wy1=wy0+TILE;
          const neigh = (rr,cc)=> (rr<0||rr>=ROWS||cc<0||cc>=COLS) ? null : MAP[rr][cc];
          const solid = ch2=> ch2==='#'||ch2==='T';
          if(!solid(neigh(r-1,c))) faces.push([[wx0,wy0],[wx1,wy0],ch]);
          if(!solid(neigh(r+1,c))) faces.push([[wx1,wy1],[wx0,wy1],ch]);
          if(!solid(neigh(r,c-1))) faces.push([[wx0,wy1],[wx0,wy0],ch]);
          if(!solid(neigh(r,c+1))) faces.push([[wx1,wy0],[wx1,wy1],ch]);
        }
      }
      faces.sort((a,b)=>{
        const da = (a[0][0]-player.x)**2+(a[0][1]-player.y)**2;
        const db = (b[0][0]-player.x)**2+(b[0][1]-player.y)**2;
        return db-da;
      });
      for(const [p0,p1,ch] of faces){
        const a = project(p0[0],p0[1],0), b = project(p1[0],p1[1],0);
        const c2 = project(p1[0],p1[1],WALL_H), d = project(p0[0],p0[1],WALL_H);
        if(!a||!b||!c2||!d) continue;
        const dist = Math.hypot((p0[0]+p1[0])/2-player.x, (p0[1]+p1[1])/2-player.y);
        const shade = Math.max(0.15, 1-dist/(TILE*16));
        const base = FPS_WALL_COLOR[ch];
        ctx.fillStyle = `rgb(${base[0]*shade|0},${base[1]*shade|0},${base[2]*shade|0})`;
        ctx.beginPath();
        ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c2.x,c2.y); ctx.lineTo(d.x,d.y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(0,0,0,${0.35*shade})`; ctx.stroke();
      }
      drawTopHud();
    }

    return { update, render };
  }

  window.NesShooter3D = { init };
})();
