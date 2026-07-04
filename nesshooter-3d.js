// NESSHOOTER 3D Addon — polygon renderer using the base game's real textures,
// optimized for speed: each quad is drawn as 2 affine-mapped triangles
// (no per-strip subdivision), images are cached once at load.
(function(){
  const PATHS = {
    '#': 'textures/tiles/wall_horizontal.png',
    'T': 'textures/tiles/tree.png',
    grass: 'textures/ground/grass.png',
    sand: 'textures/ground/sand.png',
    water: 'textures/tiles/water.png',
    wood: 'textures/ground/wood.png',
    ceil: null
  };
  function fallback(kind){
    const c=document.createElement('canvas'); c.width=64;c.height=64;
    const g=c.getContext('2d');
    const colors={'#':'#847e8c',T:'#2e7834',grass:'#368a3a',sand:'#c6b68a',water:'#285aaa',wood:'#785434',ceil:'#26262e'};
    g.fillStyle=colors[kind]||'#888'; g.fillRect(0,0,64,64);
    return c;
  }
  const TEX = {};
  for(const k in PATHS){
    TEX[k] = fallback(k);
    if(PATHS[k]){
      const img = new Image();
      img.onload = ()=>{ TEX[k] = img; };
      img.src = PATHS[k];
    }
  }

  // ---- RPG Maker MZ-style A4 wall autotile ----
  // Config: adjust these if your tileA4_walls.png uses a different path or
  // if the wall "kind" you want isn't the first one in the sheet.
  const WALL_CONFIG = { path: 'textures/tileA4_walls.png', kindCol: 0, tilePx: 16 };
  window.NesShooter3D_wallConfig = WALL_CONFIG; // tweak from devtools/console if needed

  // 16 shapes (bit0=N,bit1=E,bit2=S,bit3=W solid), each a set of 4 quarter-tile
  // [col,row] coords (in 24px quarter-tile units) to composite TL,TR,BL,BR.
  const WALL_AUTOTILE_TABLE = [
    [[2,2],[1,2],[2,1],[1,1]], [[0,2],[1,2],[0,1],[1,1]], [[2,0],[1,0],[2,1],[1,1]], [[0,0],[1,0],[0,1],[1,1]],
    [[2,2],[3,2],[2,1],[3,1]], [[0,2],[3,2],[0,1],[3,1]], [[2,0],[3,0],[2,1],[3,1]], [[0,0],[3,0],[0,1],[3,1]],
    [[2,2],[1,2],[2,3],[1,3]], [[0,2],[1,2],[0,3],[1,3]], [[2,0],[1,0],[2,3],[1,3]], [[0,0],[1,0],[0,3],[1,3]],
    [[2,2],[3,2],[2,3],[3,3]], [[0,2],[3,2],[0,3],[3,3]], [[2,0],[3,0],[2,3],[3,3]], [[0,0],[3,0],[0,3],[3,3]]
  ];

  let wallSheet = null, wallSheetReady = false;
  (function loadWallSheet(){
    const img = new Image();
    img.onload = ()=>{ wallSheet = img; wallSheetReady = true; };
    img.src = WALL_CONFIG.path;
  })();

  const wallTexCache = {};
  function shapeIndex(nSolid,eSolid,sSolid,wSolid){
    return (nSolid?1:0)|(eSolid?2:0)|(sSolid?4:0)|(wSolid?8:0);
  }
  // Builds (and caches) a 48x48 canvas for one of the 16 connectivity shapes
  // by pasting 4 quarter-tiles from the A4 sheet's "walktop" sub-block.
  function getWallTex(shape){
    if(!wallSheetReady) return TEX['#'];
    const key = WALL_CONFIG.kindCol+'_'+shape;
    if(wallTexCache[key]) return wallTexCache[key];
    const q = WALL_CONFIG.tilePx/2; // 24px quarter at default 48px tile
    const originX = WALL_CONFIG.kindCol*4*q; // kind block is 2 tiles (4 quarters) wide
    const c = document.createElement('canvas'); c.width=q*2; c.height=q*2;
    const g = c.getContext('2d');
    const corners = WALL_AUTOTILE_TABLE[shape];
    const dst = [[0,0],[q,0],[0,q],[q,q]];
    for(let i=0;i<4;i++){
      const [qx,qy] = corners[i], [dx,dy] = dst[i];
      g.drawImage(wallSheet, originX+qx*q, qy*q, q,q, dx,dy, q,q);
    }
    wallTexCache[key] = c;
    return c;
  }

  function init(deps){
    const {
      ctx, canvas, player, MAP, ROWS, COLS, TILE, W, H,
      aimTouch, mouse, keys, moveTouch,
      resolveObstacles, isIndoors, drawTopHud
    } = deps;

    let fpsPitch = 0;
    const FPS_TURN_SPEED = 2.6, FPS_PITCH_SPEED = 140, FPS_PITCH_MAX = 50, FPS_MOUSE_SENS = 0.003;
    const WALL_H = TILE, EYE_Z = TILE*0.5, FOCAL = 280;
    const RADIUS = 14;

    function floorTexAt(x,y){
      if(isIndoors(x,y)) return TEX.wood;
      const c = Math.floor(x/TILE), r = Math.floor(y/TILE);
      if(r<0||r>=ROWS||c<0||c>=COLS) return TEX.grass;
      const ch = MAP[r][c];
      if(ch==='~') return TEX.water;
      if(ch==='S') return TEX.sand;
      return TEX.grass;
    }

    function update(dt){
      player.angle += aimTouch.dx * FPS_TURN_SPEED * dt;
      player.angle += (mouse.mdx||0) * FPS_MOUSE_SENS;
      fpsPitch -= (mouse.mdy||0) * 0.5;
      mouse.mdx = 0; mouse.mdy = 0;
      if(aimTouch.active) fpsPitch -= aimTouch.dy * FPS_PITCH_SPEED * dt;
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
      ctx.fillStyle = '#26262e'; ctx.fillRect(0,0,W,H);

      const fx = Math.cos(player.angle), fy = Math.sin(player.angle);
      const rx = -fy, ry = fx;
      function project(wx,wy,wz){
        const dxw = wx-player.x, dyw = wy-player.y;
        const depth = dxw*fx + dyw*fy;
        if(depth < 0.15) return null;
        const horizd = dxw*rx + dyw*ry;
        return { x: W/2 + (horizd/depth)*FOCAL, y: horizon - ((wz-EYE_Z)/depth)*FOCAL };
      }

      const pc = Math.floor(player.x/TILE), pr = Math.floor(player.y/TILE);
      const quads = [];
      const neigh = (rr,cc)=> (rr<0||rr>=ROWS||cc<0||cc>=COLS) ? null : MAP[rr][cc];
      const solid = ch2=> ch2==='#'||ch2==='T';

      for(let r=pr-RADIUS;r<=pr+RADIUS;r++){
        if(r<0||r>=ROWS) continue;
        for(let c=pc-RADIUS;c<=pc+RADIUS;c++){
          if(c<0||c>=COLS) continue;
          const ch = MAP[r][c];
          const x0=c*TILE, y0=r*TILE, x1=x0+TILE, y1=y0+TILE, cx=(x0+x1)/2, cy=(y0+y1)/2;
          if(solid(ch)){
            let tx = TEX[ch];
            if(ch==='#'){
              const shape = shapeIndex(solid(neigh(r-1,c)), solid(neigh(r,c+1)), solid(neigh(r+1,c)), solid(neigh(r,c-1)));
              tx = getWallTex(shape);
            }
            if(!solid(neigh(r-1,c))) quads.push({p:[[x0,y0,0],[x1,y0,0],[x1,y0,WALL_H],[x0,y0,WALL_H]], tex:tx, cx, cy:y0});
            if(!solid(neigh(r+1,c))) quads.push({p:[[x1,y1,0],[x0,y1,0],[x0,y1,WALL_H],[x1,y1,WALL_H]], tex:tx, cx, cy:y1});
            if(!solid(neigh(r,c-1))) quads.push({p:[[x0,y1,0],[x0,y0,0],[x0,y0,WALL_H],[x0,y1,WALL_H]], tex:tx, cx:x0, cy});
            if(!solid(neigh(r,c+1))) quads.push({p:[[x1,y0,0],[x1,y1,0],[x1,y1,WALL_H],[x1,y0,WALL_H]], tex:tx, cx:x1, cy});
          } else {
            quads.push({p:[[x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0]], tex:floorTexAt(cx,cy), cx, cy});
            quads.push({p:[[x0,y0,WALL_H],[x1,y0,WALL_H],[x1,y1,WALL_H],[x0,y1,WALL_H]], tex:TEX.ceil, cx, cy});
          }
        }
      }

      quads.forEach(q=> q.d2 = (q.cx-player.x)**2+(q.cy-player.y)**2);
      quads.sort((a,b)=> b.d2 - a.d2);

      for(const q of quads){
        const [p0,p1,p2,p3] = q.p;
        const dist = Math.sqrt(q.d2);
        const shade = Math.max(0.2, 1-dist/(TILE*16));
        const SW = q.tex.naturalWidth || q.tex.width, SH = q.tex.naturalHeight || q.tex.height;
        // Affine (non-perspective-correct) triangle mapping only looks right
        // over small screen spans; close-up quads need more slices, distant
        // ones need almost none. Scale slice count by TILE/dist.
        const STRIPS = dist < TILE*1.5 ? 6 : dist < TILE*4 ? 3 : 1;
        for(let s=0;s<STRIPS;s++){
          const t0=s/STRIPS, t1=(s+1)/STRIPS;
          const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
          const A=lerp(p0,p1,t0), B=lerp(p0,p1,t1), C=lerp(p3,p2,t1), D=lerp(p3,p2,t0);
          const pa=project(...A), pb=project(...B), pcc=project(...C), pd=project(...D);
          if(!pa||!pb||!pcc||!pd) continue;
          const sx0=t0*SW, sx1=t1*SW;
          drawTexTri(q.tex, sx0,0, sx1,0, sx0,SH, pa.x,pa.y, pb.x,pb.y, pd.x,pd.y);
          drawTexTri(q.tex, sx1,0, sx1,SH, sx0,SH, pb.x,pb.y, pcc.x,pcc.y, pd.x,pd.y);
          if(shade<1){
            ctx.fillStyle = `rgba(0,0,0,${(1-shade)*0.75})`;
            ctx.beginPath();
            ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.lineTo(pcc.x,pcc.y); ctx.lineTo(pd.x,pd.y);
            ctx.closePath(); ctx.fill();
          }
        }
      }
      drawTopHud();
    }

    function drawTexTri(img, sx0,sy0, sx1,sy1, sx2,sy2, dx0,dy0, dx1,dy1, dx2,dy2){
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(dx0,dy0); ctx.lineTo(dx1,dy1); ctx.lineTo(dx2,dy2); ctx.closePath(); ctx.clip();
      const denom = sx0*(sy1-sy2) - sx1*(sy0-sy2) + sx2*(sy0-sy1);
      if(Math.abs(denom) < 1e-6){ ctx.restore(); return; }
      const a = (dx0*(sy1-sy2) - dx1*(sy0-sy2) + dx2*(sy0-sy1)) / denom;
      const b = (dy0*(sy1-sy2) - dy1*(sy0-sy2) + dy2*(sy0-sy1)) / denom;
      const c = (sx0*(dx1-dx2) - sx1*(dx0-dx2) + sx2*(dx0-dx1)) / denom;
      const d = (sx0*(dy1-dy2) - sx1*(dy0-dy2) + sx2*(dy0-dy1)) / denom;
      const e = dx0 - a*sx0 - c*sy0;
      const f = dy0 - b*sx0 - d*sy0;
      ctx.setTransform(a,b,c,d,e,f);
      ctx.drawImage(img,0,0);
      ctx.restore();
    }

    return { update, render };
  }

  window.NesShooter3D = { init };
})();
