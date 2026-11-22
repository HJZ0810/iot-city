# MySQL 8.0 schema contract v1

Codex owns migrations. All id columns VARCHAR(80) unless noted. All created_at/updated_at DATETIME(3) UTC, defaults CURRENT_TIMESTAMP(3). JSON parsed by mysql2 automatically; helpers accept arrays as positional params only. Use placeholders for all values; dynamic SQL identifiers only from a whitelist. Date output normalize to ISO strings.

Tables:
- users(id PK,username VARCHAR(40) UNIQUE,nickname VARCHAR(80),password_hash TEXT,role ENUM student/teacher/admin,disabled BOOLEAN DEFAULT 0,created_at,updated_at)
- auth_sessions(id CHAR(64) PK,user_id FK users,expires_at DATETIME(3),created_at). id is SHA256 of random cookie token, never plaintext.
- classes(id PK,name VARCHAR(140),code VARCHAR(12) UNIQUE,teacher_id FK users,created_at)
- class_groups(id PK,class_id FK classes,name VARCHAR(100),created_at)
- class_members(class_id,user_id,group_id NULL,joined_at DATETIME(3),PK(class_id,user_id))
- assignments(id PK,class_id FK classes,level_id VARCHAR(80),title VARCHAR(160),mode VARCHAR(20),due_at DATETIME(3) NULL,created_at)
- chapters(id INT PK,title VARCHAR(100),definition JSON)
- knowledge_points(id VARCHAR(100) PK,name VARCHAR(100))
- levels(id PK,owner_id FK users NULL,number INT,chapter INT,title VARCHAR(100),status ENUM draft/published/disabled,current_version INT,global_published BOOLEAN DEFAULT 0,class_id VARCHAR(80) NULL,created_at,updated_at)
- level_versions(level_id,version INT,definition JSON,created_by VARCHAR(80) NULL,created_at,PK(level_id,version)); immutable after insertion
- level_knowledge(level_id,knowledge_id,PK(level_id,knowledge_id))
- game_sessions(id PK,user_id FK users,mode VARCHAR(20),level_id VARCHAR(80),level_version INT,seed BIGINT,state JSON,initial_state JSON,revision INT,status VARCHAR(20),preview BOOLEAN DEFAULT 0,elapsed_ms BIGINT DEFAULT 0,last_active_at DATETIME(3),created_at,updated_at)
- game_events(id VARCHAR(100),session_id FK game_sessions,sequence INT,command JSON,accepted BOOLEAN,message VARCHAR(1500),state JSON NULL,created_at,PK(session_id,id),UNIQUE(session_id,sequence))；state仅每25事件与模式特殊转换时保存，用于回放校验与跳转
- results(id PK,session_id VARCHAR(80),user_id FK users,mode VARCHAR(20),level_id VARCHAR(80),score INT,stars INT,elapsed_seconds INT,team_id VARCHAR(80) NULL,room_id VARCHAR(80) NULL,season_id VARCHAR(80),won BOOLEAN NULL,created_at,UNIQUE(session_id,user_id))
- rooms(id PK,code VARCHAR(12) UNIQUE,state JSON,status VARCHAR(20),updated_at)
- teams(id PK,name VARCHAR(100),class_id VARCHAR(80) NULL,created_at)
- team_members(team_id,user_id,PK(team_id,user_id))
- seasons(id PK,name VARCHAR(100),active BOOLEAN DEFAULT 1,created_at)
- sandbox_projects(id PK,user_id FK users,name VARCHAR(140),definition JSON,created_at,updated_at)
- achievements(user_id,achievement_id VARCHAR(80),created_at,PK(user_id,achievement_id))
- audit_logs(id PK,actor_id VARCHAR(80) NULL,action VARCHAR(100),target_id VARCHAR(100),details JSON,created_at)
- settings(id VARCHAR(80) PK,value JSON)
- assets(id PK,name VARCHAR(140),url VARCHAR(500),license VARCHAR(200),source VARCHAR(500),owner_id VARCHAR(80),created_at)
- hw_devices(id PK,installation_id UNIQUE,model,firmware,token_hash CHAR(64),pair_code,pair_expires_at,user_id FK users NULL,name,caps JSON,status ENUM(pending/bound/revoked),last_seen_at,last_ip,created_at,updated_at)
- hw_sessions(id PK,device_id FK hw_devices,user_id FK users,game_session_id NULL,last_frame_rev,input_count,attached_at,closed_at)
- hw_events(id PK,device_id FK hw_devices,kind,payload JSON,accepted,message,created_at)
- board_sessions(id PK,user_id FK users,level_id,status,run JSON,score,stars,started_at,finished_at,updated_at)（一个用户同时只应有一个 status=running）
- board_results(id PK,session_id UNIQUE,user_id FK users,level_id,chapter,kind,score,stars,hints,failures,evidence_digest CHAR(64),created_at)

board_results 只在关卡通过或失败时写入（按 session_id 幂等），放弃局不产生成绩；板端榜单取同一用户的最高的 score，班级榜以 class_members 过滤。evidence_digest 是证据链哈希，用于教师复核判定依据。

No query may return password_hash/auth session ids. Owner/class authorization must precede any list/detail/update. Content scopes: global published OR class membership OR author OR admin. Class members read; class teacher/admin write. Student must not query arbitrary class exports/replays. Last admin cannot demote/disable self if no other active admin. Role changes revoke auth_sessions. Default new content id UUID; retain id when author updates an existing draft. Draft edits create a new immutable level_version (current_version+1); publishing refers to that version. Rollback creates a new version cloned from old, never overwrites prior JSON. Do not overwrite seed levels owned by system from teacher routes.

Context errors: import `httpError(status:number,code:string,message:string,details?:unknown)` from `../errors.js`; IDs use `randomUUID` from node:crypto. Password helpers `hashPassword(password:string):Promise<string>` from `../auth.js`. Generic database helper import type `Database` from `../db.js`. Table names exactly as above.
