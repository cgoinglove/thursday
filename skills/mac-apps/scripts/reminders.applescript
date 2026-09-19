-- osascript reminders.applescript [LIST]
-- Reminders not yet done, one per line: due<TAB>list<TAB>title. `-` means no due date.
-- With LIST, only that list.
on run argv
	set out to ""
	tell application "Reminders"
		if (count of argv) > 0 then
			set ls to {list (item 1 of argv)}
		else
			set ls to lists
		end if
		repeat with l in ls
			set lname to name of l
			set pending to (a reference to (every reminder of l whose completed is false))
			set {titles, dues} to {name, due date} of pending
			repeat with i from 1 to count of titles
				set dd to item i of dues
				if dd is missing value then
					set ds to "-"
				else
					set ds to (dd as «class isot» as string)
				end if
				set out to out & ds & tab & lname & tab & (item i of titles) & linefeed
			end repeat
		end repeat
	end tell
	return out
end run
