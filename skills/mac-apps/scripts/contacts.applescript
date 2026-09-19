-- osascript contacts.applescript TEXT
-- People whose name contains TEXT, one per line: name<TAB>phones<TAB>emails<TAB>birthday.
-- Several phones or emails are joined with ", ".
on run argv
	set out to ""
	set AppleScript's text item delimiters to ", "
	tell application "Contacts"
		set found to (get every person whose name contains (item 1 of argv))
		repeat with p in found
			set bd to birth date of p
			if bd is missing value then
				set bs to ""
			else
				set bs to (bd as «class isot» as string)
			end if
			set out to out & (name of p) & tab & ((value of phones of p) as text) & tab & ((value of emails of p) as text) & tab & bs & linefeed
		end repeat
	end tell
	return out
end run
