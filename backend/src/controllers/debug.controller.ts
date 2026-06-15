import { Controller, Get, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import { DbService } from '../database/db.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

// Admin-only endpoints. Previously this controller had NO guard at all —
// any unauthenticated request could run DDL (run-migrations) or list the
// server filesystem (/fs). Both are now JWT-protected and refuse non-admins.
@Controller('api/debug')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DebugController {
    constructor(private readonly db: DbService) {}

    private requireAdmin(req: any) {
        if (req.user?.role?.toLowerCase() !== 'admin') {
            throw new ForbiddenException('Admin only');
        }
    }

    @Get('run-migrations')
    async runMigrations(@Request() req: any) {
        this.requireAdmin(req);
        const results: string[] = [];
        
        const migrations = [
            // Customer table
            `ALTER TABLE customer ADD COLUMN e_invoice VARCHAR(20)`,
            `ALTER TABLE customer ADD COLUMN business_type VARCHAR(100)`,
            `ALTER TABLE customer ADD COLUMN accounts_person_type VARCHAR(100)`,
            `ALTER TABLE customer ADD COLUMN it_person VARCHAR(255)`,
            `ALTER TABLE customer ADD COLUMN ca_name VARCHAR(255)`,
            `ALTER TABLE customer ADD COLUMN business_description TEXT`,
            `ALTER TABLE customer ADD COLUMN e_way_bill VARCHAR(20)`,
            `ALTER TABLE customer ADD COLUMN connected_banking VARCHAR(20)`,
            `ALTER TABLE customer ADD COLUMN whatsapp_enabled VARCHAR(20)`,
            `ALTER TABLE customer ADD COLUMN customisation VARCHAR(20)`,
            `ALTER TABLE customer ADD COLUMN tally_slow VARCHAR(20)`,
            `ALTER TABLE customer ADD COLUMN loyalty VARCHAR(50)`,
            `ALTER TABLE customer ADD COLUMN conversion_probability VARCHAR(50)`,
            `ALTER TABLE customer ADD COLUMN customer_behaviour TEXT`,
            // cloud_tdl_tasks table
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN e_invoice VARCHAR(20)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN business_type VARCHAR(100)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN accounts_person_type VARCHAR(100)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN it_person VARCHAR(255)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN ca_name VARCHAR(255)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN business_description TEXT`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN e_way_bill VARCHAR(20)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN connected_banking VARCHAR(20)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN whatsapp_enabled VARCHAR(20)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN customisation VARCHAR(20)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN tally_slow VARCHAR(20)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN loyalty VARCHAR(50)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN conversion_probability VARCHAR(50)`,
            `ALTER TABLE cloud_tdl_tasks ADD COLUMN customer_behaviour TEXT`,
            // cloud_visits table (THIS IS THE CRITICAL ONE FOR CHECKOUT)
            `ALTER TABLE cloud_visits ADD COLUMN e_invoice VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN business_type VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN accounts_person_type VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN it_person VARCHAR(100)`,
            `ALTER TABLE cloud_visits ADD COLUMN ca_name VARCHAR(100)`,
            `ALTER TABLE cloud_visits ADD COLUMN business_description TEXT`,
            `ALTER TABLE cloud_visits ADD COLUMN e_way_bill VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN connected_banking VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN whatsapp_enabled VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN customisation VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN tally_slow VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN loyalty VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN conversion_probability VARCHAR(50)`,
            `ALTER TABLE cloud_visits ADD COLUMN check_out_response VARCHAR(100)`,
            `ALTER TABLE cloud_visits ADD COLUMN customer_behaviour TEXT`,
        ];

        for (const sql of migrations) {
            try {
                await this.db.execute(sql);
                results.push(`✓ ${sql.substring(0, 60)}...`);
            } catch (e: any) {
                // Ignore "duplicate column" errors
                if (!e.message?.includes('Duplicate column')) {
                    results.push(`✗ ${sql.substring(0, 40)}... - ${e.message}`);
                } else {
                    results.push(`~ ${sql.substring(0, 60)}... (already exists)`);
                }
            }
        }

        return { success: true, results };
    }
    @Get('fs')
    checkFileSystem(@Request() req: any) {
        this.requireAdmin(req);
        const cwd = process.cwd();
        const dirname = __dirname;
        const clientPathCwd = join(cwd, 'client');
        const clientPathDir = join(dirname, '..', 'client');

        const listDir = (path: string) => {
            try {
                return readdirSync(path).map(f => {
                    const stat = statSync(join(path, f));
                    return { name: f, isDir: stat.isDirectory(), size: stat.size };
                });
            } catch (e) {
                return `Error: ${e.message}`;
            }
        };

        return {
            info: 'FileSystem Diagnostic',
            env: {
                cwd,
                dirname,
                NODE_ENV: process.env.NODE_ENV,
            },
            paths: {
                client_via_cwd: {
                    path: clientPathCwd,
                    contents: listDir(clientPathCwd),
                },
                client_via_dirname: {
                    path: clientPathDir,
                    contents: listDir(clientPathDir),
                },
                // Check specifically for static/js
                static_js_cwd: {
                    path: join(clientPathCwd, 'static', 'js'),
                    contents: listDir(join(clientPathCwd, 'static', 'js')),
                }
            }
        };
    }
}
