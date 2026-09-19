-- osascript events.applescript FROM DAYS
-- Events starting from FROM days after today (0 = today, -1 = yesterday) for DAYS days,
-- one per line: start<TAB>end<TAB>calendar<TAB>title<TAB>location.
-- Calendar returns a repeating event only on the day it first happened, so every
-- repeating event that started before the window follows as a `repeats` line with its
-- rule (RRULE); work out from the rule whether it falls inside the window.
on run argv
	set d0 to current date
	set hours of d0 to 0
	set minutes of d0 to 0
	set seconds of d0 to 0
	set d0 to d0 + ((item 1 of argv) as integer) * days
	set d1 to d0 + ((item 2 of argv) as integer) * days
	set out to ""
	tell application "Calendar"
		repeat with c in calendars
			set cname to name of c
			-- One Apple event per property, not per event: asking each event is minutes on a full calendar
			set hits to (a reference to (every event of c whose start date ≥ d0 and start date < d1))
			set {starts, ends, titles, places} to {start date, end date, summary, location} of hits
			repeat with i from 1 to count of starts
				set out to out & my iso(item i of starts) & tab & my iso(item i of ends) & tab & cname & tab & (item i of titles) & tab & my text_of(item i of places) & linefeed
			end repeat
			try
				set reps to (a reference to (every event of c whose start date < d0 and recurrence contains "FREQ"))
				set {starts, titles, rules} to {start date, summary, recurrence} of reps
				repeat with i from 1 to count of starts
					set out to out & "repeats" & tab & my iso(item i of starts) & tab & cname & tab & (item i of titles) & tab & (item i of rules) & linefeed
				end repeat
			end try
		end repeat
	end tell
	return out
end run

on iso(d)
	return (d as «class isot» as string)
end iso

on text_of(v)
	if v is missing value then return ""
	return v as string
end text_of
