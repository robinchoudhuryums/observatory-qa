CREATE TABLE "analyses" (
	"id" varchar PRIMARY KEY NOT NULL,
	"call_id" varchar NOT NULL,
	"performance_score" numeric,
	"talk_time_ratio" numeric,
	"response_time" numeric,
	"keywords" jsonb,
	"topics" jsonb,
	"summary" text,
	"action_items" jsonb,
	"feedback" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "analyses_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" varchar PRIMARY KEY NOT NULL,
	"employee_id" varchar,
	"file_name" text,
	"file_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"duration" integer,
	"assemblyai_id" text,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text NOT NULL,
	"initials" varchar(2),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sentiments" (
	"id" varchar PRIMARY KEY NOT NULL,
	"call_id" varchar NOT NULL,
	"overall_sentiment" text,
	"overall_score" numeric,
	"segments" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sentiments_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"call_id" varchar NOT NULL,
	"text" text,
	"confidence" numeric,
	"words" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "transcripts_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiments" ADD CONSTRAINT "sentiments_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;