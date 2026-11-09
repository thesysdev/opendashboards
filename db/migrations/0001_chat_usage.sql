CREATE TABLE "chat_usage" (
	"day" date NOT NULL,
	"user_id" text NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"active_until" timestamp with time zone,
	CONSTRAINT "chat_usage_day_user_id_pk" PRIMARY KEY("day","user_id")
);
