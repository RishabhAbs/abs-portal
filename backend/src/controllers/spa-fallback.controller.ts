import { Controller, Get, Req, Res, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

@Controller()
export class SpaFallbackController {
    @Get('*')
    serveSpa(@Req() req: Request, @Res() res: Response) {
        const path = req.path;

        if (path.startsWith('/api')) {
            throw new NotFoundException(`API Route not found: ${path}`);
        }

        // Potential File Path Search (Robust)
        // We look for the file requested. If not found, and it's not a static asset type, we serve index.html.

        // 1. Calculate possible physical paths
        // Remove leading slash for join
        const safePath = path.startsWith('/') ? path.substring(1) : path;

        // __dirname points to dist/src/controllers
        // We want to reach dist/client
        // Use process.cwd() to be consistent with app.module.ts
        const clientDir = join(process.cwd(), '../frontend/build');

        const searchBaseDirs = [clientDir];

        // 2. Try to find the EXACT file first (e.g. main.css)
        for (const baseDir of searchBaseDirs) {
            const fullPath = join(baseDir, safePath);
            if (existsSync(fullPath)) {
                return res.sendFile(fullPath);
            }
        }

        // 3. If exact file not found, check if it was supposed to be a static asset
        if (path.startsWith('/static') || path.match(/\.(js|css|json|ico|png|jpg|jpeg|svg|woff|woff2)$/)) {
            // It was a static asset request, but we couldn't find it.
            // Log it for debugging.
            console.error(`❌ STATIC ASSET MISSING: ${path}`);
            console.error(`Searched in: ${searchBaseDirs.join(', ')}`);
            throw new NotFoundException(`Static asset not found: ${path}`);
        }

        // 4. Default to index.html for SPA navigation
        for (const baseDir of searchBaseDirs) {
            const indexPath = join(baseDir, 'index.html');
            if (existsSync(indexPath)) {
                return res.sendFile(indexPath);
            }
        }

        // 5. Total Failure
        console.error('❌ SPA FAILURE: Could not find index.html');
        throw new NotFoundException(`Client application not installed. Searched: ${searchBaseDirs.join(', ')}`);
    }
}
