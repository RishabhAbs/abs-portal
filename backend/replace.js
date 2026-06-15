const fs = require('fs');
const path = require('path');

const dir = 'd:/cloud_backup/abscloud/backend/src/controllers';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

files.forEach(f => {
    const p = path.join(dir, f);
    let c = fs.readFileSync(p, 'utf8');
    
    // First, handle the longer patterns to avoid double replacement
    let nc = c.replace(/req\.user\.role !== 'admin'/g, "req.user?.role?.toLowerCase() !== 'admin'");
    nc = nc.replace(/user && user\.role !== 'admin'/g, "user && user?.role?.toLowerCase() !== 'admin'");
    nc = nc.replace(/user\.role !== 'admin'/g, "user?.role?.toLowerCase() !== 'admin'");
    
    if (c !== nc) {
        fs.writeFileSync(p, nc);
        console.log('Updated ' + f);
    }
});
