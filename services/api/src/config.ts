import type {FastifyInstance} from 'fastify';
import type {AppContext} from './context.ts';
import {json} from './db.ts';

export async function registerConfig(app:FastifyInstance,ctx:AppContext) {
  app.get('/api/config',async req=>{
    await ctx.requireUser(req);
    const rows=await ctx.db.query<{id:string;value:unknown}>("SELECT id,value FROM settings WHERE id IN ('seasonId','dailyRefreshHour','eventRetentionDays','maxRoomPlayers')");
    const values=Object.fromEntries(rows.map(row=>[row.id,json(row.value)]));
    const id=String(values.seasonId??'season-1');
    const seasons=await ctx.db.query<{name:string}>('SELECT name FROM seasons WHERE id=?',[id]);
    return {data:{season:{id,name:seasons[0]?.name??id},dailyRefreshHour:Number(values.dailyRefreshHour??0),eventRetentionDays:Number(values.eventRetentionDays??180),maxRoomPlayers:Number(values.maxRoomPlayers??4),scoringRules:{baseScore:1000,hintPenalty:60,errorPenalty:15,extraActionPenalty:2,extraActionGrace:5,threeStars:900,twoStars:650,pvpWin:1000,pvpDraw:500,pvpLoss:200,minimumCoopContributors:2}}};
  });
}
