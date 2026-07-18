// GLB files are served from public/models/ for Replit compatibility.
// stand.glb            — the wooden/metal frame; never moves
// laddugopalsittingonseat.glb — Laddu Gopal + seat + both chains; the entire moving assembly
export const STAND_URL = "/models/stand.glb";
export const SWING_ASSEMBLY_URL = "/models/laddugopalsittingonseat.glb";

// Legacy aliases kept so other files that may import them don't break
export const SWING_URL = STAND_URL;
export const LADDU_URL = SWING_ASSEMBLY_URL;
