import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';

export interface State {
    id: number;
    name: string;
}

@Injectable()
export class StateService {
    constructor(private db: DbService) { }

    async findAll(): Promise<State[]> {
        return this.db.query<State>('SELECT id, name FROM state ORDER BY name');
    }
}
