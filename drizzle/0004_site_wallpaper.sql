CREATE TABLE "site_settings" (
	"setting_key" varchar(100) PRIMARY KEY NOT NULL,
	"setting_value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
